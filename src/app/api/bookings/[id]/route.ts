import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

// FR-04: view a single booking.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole();
  if (error) return error;

  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      customer: true,
      trip: { include: { operator: true } },
      event: { include: { organizer: true } },
      seats: { include: { seat: true } },
      ticketSelections: { include: { ticketType: true } },
      payment: true,
    },
  });

  if (!booking) return apiError(404, "BOOKING_NOT_FOUND", "Booking not found.");

  const staffRoles = ["BOOKING_OFFICER", "OPERATIONS_MANAGER", "ADMINISTRATOR", "CUSTOMER_SUPPORT", "TICKET_INSPECTOR"];
  const isOwner = booking.customer.userId === session!.user.id;
  const isStaff = staffRoles.includes(session!.user.role);
  if (!isOwner && !isStaff) {
    return apiError(403, "FORBIDDEN", "You do not have access to this booking.");
  }

  return apiOk(booking);
}
