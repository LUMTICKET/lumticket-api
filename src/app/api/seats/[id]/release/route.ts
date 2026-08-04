import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

// FR-22 (manual path): customer changes their mind before the hold expires.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireRole("CUSTOMER", "BOOKING_OFFICER", "RETAIL_POS_AGENT", "ADMINISTRATOR");
  if (error) return error;

  const { id: seatId } = await params;

  const result = await prisma.seat.updateMany({
    where: { id: seatId, status: "HELD" },
    data: { status: "AVAILABLE", holdExpiresAt: null },
  });

  if (result.count === 0) {
    return apiError(409, "SEAT_NOT_HELD", "Seat is not currently held.");
  }

  return apiOk({ seatId, status: "AVAILABLE" });
}
