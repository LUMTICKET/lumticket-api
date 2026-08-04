import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk } from "@/lib/api-response";

const bodySchema = z.object({
  bookingId: z.string().uuid(),
  gatewayRef: z.string().min(1),
  status: z.enum(["SUCCESSFUL", "FAILED"]),
  amount: z.coerce.number().positive(),
});

/**
 * FR-11 / FR-24: licensed payment-gateway callback. This is a stub for
 * whichever processor is integrated later — verify its actual signature
 * scheme here (HMAC header, etc.) instead of PAYMENT_GATEWAY_WEBHOOK_SECRET.
 *
 * FR-24: if the gateway confirms a transaction but no matching
 * PaymentSettlement exists (the booking write failed), the mismatch is
 * logged to PaymentReconciliationIncident for manual review rather than
 * silently dropped.
 */
export async function POST(request: NextRequest) {
  const providedSecret = request.headers.get("x-webhook-secret");
  if (!providedSecret || providedSecret !== process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET) {
    return apiError(401, "UNAUTHORIZED", "Invalid webhook secret.");
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid webhook payload.", parsed.error.flatten());
  }
  const { bookingId, gatewayRef, status, amount } = parsed.data;

  const payment = await prisma.paymentSettlement.findUnique({ where: { bookingId } });

  if (!payment) {
    await prisma.paymentReconciliationIncident.create({
      data: {
        bookingId,
        gatewayRef,
        amount,
        reason: "Gateway confirmed a transaction but no matching PaymentSettlement/booking record exists.",
      },
    });
    return apiOk({ acknowledged: true, reconciliationLogged: true }, 202);
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentSettlement.update({
      where: { id: payment.id },
      data: { gatewayRef, status, paidAt: status === "SUCCESSFUL" ? new Date() : null },
    });

    if (status === "SUCCESSFUL") {
      await tx.booking.update({ where: { id: bookingId }, data: { status: "CONFIRMED" } });
    } else {
      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { seats: true } });
      if (booking) {
        await tx.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
        if (booking.seats.length > 0) {
          await tx.seat.updateMany({
            where: { id: { in: booking.seats.map((s) => s.seatId) } },
            data: { status: "AVAILABLE", holdExpiresAt: null },
          });
        }
      }
    }
  });

  return apiOk({ acknowledged: true });
}
