import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

// FR-06 / UC-P02: real-time parcel status + handling history.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole();
  if (error) return error;

  const { id } = await params;
  const parcel = await prisma.parcel.findUnique({
    where: { id },
    include: {
      sender: true,
      courier: true,
      handlingLogs: { orderBy: { timestamp: "asc" } },
    },
  });
  if (!parcel) return apiError(404, "PARCEL_NOT_FOUND", "Parcel not found.");

  const staffRoles = ["DISPATCHER", "OPERATIONS_MANAGER", "ADMINISTRATOR", "CUSTOMER_SUPPORT", "DRIVER"];
  const isOwner = parcel.sender.userId === session!.user.id;
  const isAssignedDriver = session!.user.role === "DRIVER" && parcel.courier?.userId === session!.user.id;
  if (!isOwner && !isAssignedDriver && !staffRoles.includes(session!.user.role)) {
    return apiError(403, "FORBIDDEN", "You do not have access to this parcel.");
  }

  return apiOk(parcel);
}
