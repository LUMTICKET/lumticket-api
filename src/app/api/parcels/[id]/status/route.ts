import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

const bodySchema = z.object({
  status: z.enum(["COLLECTED", "IN_TRANSIT", "SORTING", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"]),
  location: z.string().optional(),
  notes: z.string().optional(),
  courierId: z.string().uuid().optional(),
});

// FR-06 / FR-07 / UC-P03: advance parcel status; DELIVERED closes the transaction.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireRole("DISPATCHER", "DRIVER", "OPERATIONS_MANAGER", "ADMINISTRATOR");
  if (error) return error;

  const { id } = await params;
  const parcel = await prisma.parcel.findUnique({ where: { id } });
  if (!parcel) return apiError(404, "PARCEL_NOT_FOUND", "Parcel not found.");
  if (parcel.status === "DELIVERED") {
    return apiError(409, "PARCEL_ALREADY_CLOSED", "This parcel's transaction is already closed.");
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { status, location, notes, courierId } = parsed.data;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.parcel.update({
      where: { id },
      data: { status, ...(courierId ? { courierId } : {}) },
    });
    await tx.parcelHandlingLog.create({
      data: { parcelId: id, actorId: session!.user.id, status, location, notes },
    });
    return result;
  });

  return apiOk(updated);
}
