import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

const bodySchema = z.object({ seatId: z.string().uuid() });

// FR-21: place a time-bound hold on a selected seat.
export async function POST(request: NextRequest) {
  const { error } = await requireRole("CUSTOMER", "BOOKING_OFFICER", "RETAIL_POS_AGENT", "ADMINISTRATOR");
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { seatId } = parsed.data;

  const seat = await prisma.seat.findUnique({ where: { id: seatId }, include: { trip: true } });
  if (!seat) return apiError(404, "SEAT_NOT_FOUND", "Seat not found.");

  // Lazy-release if a previous hold has expired, then atomically claim it.
  const now = new Date();
  if (seat.status === "HELD" && seat.holdExpiresAt && seat.holdExpiresAt < now) {
    await prisma.seat.update({ where: { id: seatId }, data: { status: "AVAILABLE", holdExpiresAt: null } });
  }

  const holdExpiresAt = new Date(now.getTime() + seat.trip.seatHoldMinutes * 60_000);
  const result = await prisma.seat.updateMany({
    where: { id: seatId, status: "AVAILABLE" },
    data: { status: "HELD", holdExpiresAt },
  });

  if (result.count === 0) {
    return apiError(409, "SEAT_UNAVAILABLE", "This seat is no longer available.");
  }

  return apiOk({ seatId, status: "HELD", holdExpiresAt });
}
