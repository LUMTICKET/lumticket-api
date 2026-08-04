import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

// FR-04: cancel a booking / request a refund, releasing any booked seats.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole();
  if (error) return error;

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { customer: true, seats: true, payment: true },
  });
  if (!booking) return apiError(404, "BOOKING_NOT_FOUND", "Booking not found.");

  const staffRoles = ["BOOKING_OFFICER", "CUSTOMER_SUPPORT", "ADMINISTRATOR"];
  const isOwner = booking.customer.userId === session!.user.id;
  if (!isOwner && !staffRoles.includes(session!.user.role)) {
    return apiError(403, "FORBIDDEN", "You cannot cancel this booking.");
  }

  if (booking.status === "CANCELLED") {
    return apiError(409, "ALREADY_CANCELLED", "This booking is already cancelled.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id }, data: { status: "CANCELLED" } });

    if (booking.seats.length > 0) {
      await tx.seat.updateMany({
        where: { id: { in: booking.seats.map((s) => s.seatId) } },
        data: { status: "AVAILABLE", holdExpiresAt: null },
      });
    }

    if (booking.payment && booking.payment.status === "SUCCESSFUL") {
      // Real refund requires calling the payment gateway's refund API
      // (FR-11 — the platform never holds funds directly). Recorded here so
      // it surfaces in settlement/reconciliation reporting (FR-13, FR-18).
      await tx.paymentSettlement.update({ where: { id: booking.payment.id }, data: { status: "REFUNDED" } });
    }
  });

  return apiOk({ id, status: "CANCELLED" });
}
