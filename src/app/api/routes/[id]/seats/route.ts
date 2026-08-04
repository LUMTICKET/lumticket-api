import { prisma } from "@/lib/prisma";
import { apiError, apiOk } from "@/lib/api-response";

// UC-B02: live seat map. Lazily releases any expired holds first so
// availability shown here is always accurate even between cron sweeps
// (see /api/cron/release-expired-holds for the authoritative sweep, FR-22).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: tripId } = await params;

  const trip = await prisma.routeTrip.findUnique({ where: { id: tripId } });
  if (!trip) return apiError(404, "TRIP_NOT_FOUND", "Trip not found.");

  await prisma.seat.updateMany({
    where: { tripId, status: "HELD", holdExpiresAt: { lt: new Date() } },
    data: { status: "AVAILABLE", holdExpiresAt: null },
  });

  const seats = await prisma.seat.findMany({
    where: { tripId },
    orderBy: { seatNo: "asc" },
    select: { id: true, seatNo: true, status: true, holdExpiresAt: true },
  });

  return apiOk({ tripId, price: trip.price, seats });
}
