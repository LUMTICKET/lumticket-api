import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk, paginated, parsePagination } from "@/lib/api-response";
import { resolveCustomerId } from "@/lib/customer";
import { withIdempotency } from "@/lib/idempotency";
import { generateBookingRef, generateTicketCode } from "@/lib/ticket-code";
import { DEFAULT_CURRENCY } from "@/lib/constants";

const bodySchema = z
  .object({
    customerId: z.string().uuid().optional(),
    tripId: z.string().uuid().optional(),
    seatIds: z.array(z.string().uuid()).optional(),
    eventId: z.string().uuid().optional(),
    ticketSelections: z
      .array(z.object({ ticketTypeId: z.string().uuid(), quantity: z.number().int().positive() }))
      .optional(),
    paymentMethod: z.enum(["ONLINE", "POS"]),
  })
  .refine(
    (data) => (data.tripId && data.seatIds?.length) || (data.eventId && data.ticketSelections?.length),
    { message: "Provide either { tripId, seatIds } for a bus booking or { eventId, ticketSelections } for an event booking." },
  );

// FR-02, FR-03, FR-04, FR-21..23; UC-B02, UC-B03: create a booking.
// Requires an `Idempotency-Key` header (API-03) so retries never double-book.
export async function POST(request: NextRequest) {
  const { session, error } = await requireRole("CUSTOMER", "BOOKING_OFFICER", "RETAIL_POS_AGENT", "ADMINISTRATOR");
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const body = parsed.data;

  const customerResolution = await resolveCustomerId(session!, body.customerId);
  if ("error" in customerResolution) {
    return apiError(422, customerResolution.error, "Could not resolve the customer for this booking.");
  }
  const { customerId } = customerResolution;
  const isStaffAssisted = session!.user.role !== "CUSTOMER";

  return withIdempotency(request, "POST /api/bookings", async () => {
    try {
      const booking = await prisma.$transaction(async (tx) => {
        let amount = 0;

        const created = await tx.booking.create({
          data: {
            customerId,
            tripId: body.tripId,
            eventId: body.eventId,
            bookingRef: generateBookingRef(),
            status: body.paymentMethod === "POS" ? "CONFIRMED" : "PENDING",
            idempotencyKey: request.headers.get("Idempotency-Key"),
          },
        });

        if (body.tripId && body.seatIds?.length) {
          const trip = await tx.routeTrip.findUniqueOrThrow({ where: { id: body.tripId } });
          amount = Number(trip.price) * body.seatIds.length;

          const claimable = isStaffAssisted ? ["AVAILABLE", "HELD"] : ["HELD"];
          const claim = await tx.seat.updateMany({
            where: { id: { in: body.seatIds }, tripId: body.tripId, status: { in: claimable as never } },
            data: { status: "BOOKED", holdExpiresAt: null },
          });
          if (claim.count !== body.seatIds.length) {
            throw new BookingConflict("One or more selected seats are no longer available.");
          }
          await tx.bookingSeat.createMany({
            data: body.seatIds.map((seatId) => ({ bookingId: created.id, seatId })),
          });
        }

        if (body.eventId && body.ticketSelections?.length) {
          for (const selection of body.ticketSelections) {
            const ticketType = await tx.ticketType.findUniqueOrThrow({ where: { id: selection.ticketTypeId } });
            const newSold = ticketType.quantitySold + selection.quantity;
            if (newSold > ticketType.quantity) {
              throw new BookingConflict(`Not enough "${ticketType.name}" tickets remaining.`);
            }
            const claim = await tx.ticketType.updateMany({
              where: { id: ticketType.id, quantitySold: ticketType.quantitySold },
              data: { quantitySold: newSold },
            });
            if (claim.count === 0) {
              throw new BookingConflict("Ticket availability changed concurrently; please retry.");
            }
            amount += Number(ticketType.price) * selection.quantity;
            await tx.bookingTicketType.create({
              data: { bookingId: created.id, ticketTypeId: ticketType.id, quantity: selection.quantity },
            });
          }
        }

        const qrCode = generateTicketCode(created.id);
        const finalBooking = await tx.booking.update({ where: { id: created.id }, data: { qrCode } });

        await tx.paymentSettlement.create({
          data: {
            bookingId: created.id,
            amount,
            currency: DEFAULT_CURRENCY,
            status: body.paymentMethod === "POS" ? "SUCCESSFUL" : "INITIATED",
            paidAt: body.paymentMethod === "POS" ? new Date() : null,
          },
        });

        return finalBooking;
      });

      const full = await prisma.booking.findUnique({
        where: { id: booking.id },
        include: { seats: { include: { seat: true } }, ticketSelections: true, payment: true },
      });

      return apiOk(full, 201);
    } catch (err) {
      if (err instanceof BookingConflict) {
        return apiError(409, "BOOKING_CONFLICT", err.message);
      }
      throw err;
    }
  });
}

class BookingConflict extends Error {}

export async function GET(request: NextRequest) {
  const { session, error } = await requireRole();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const where =
    session!.user.role === "CUSTOMER"
      ? { customer: { userId: session!.user.id } }
      : {};

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      skip,
      take,
      orderBy: { bookedAt: "desc" },
      include: { payment: true },
    }),
    prisma.booking.count({ where }),
  ]);

  return apiOk(paginated(items, total, page, pageSize));
}
