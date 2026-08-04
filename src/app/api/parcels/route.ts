import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk, paginated, parsePagination } from "@/lib/api-response";
import { resolveCustomerId } from "@/lib/customer";

const bodySchema = z.object({
  customerId: z.string().uuid().optional(),
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(1),
  pickupLocation: z.string().min(1),
  deliveryLocation: z.string().min(1),
  weight: z.coerce.number().positive().optional(),
});

// FR-05 / UC-P01: register a parcel with sender, recipient, and item details.
export async function POST(request: NextRequest) {
  const { session, error } = await requireRole("CUSTOMER", "RETAIL_POS_AGENT", "ADMINISTRATOR");
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { customerId: bodyCustomerId, ...rest } = parsed.data;

  const resolution = await resolveCustomerId(session!, bodyCustomerId);
  if ("error" in resolution) {
    return apiError(422, resolution.error, "Could not resolve the sender for this parcel.");
  }

  const parcel = await prisma.$transaction(async (tx) => {
    const created = await tx.parcel.create({ data: { senderId: resolution.customerId, ...rest } });
    await tx.parcelHandlingLog.create({
      data: { parcelId: created.id, actorId: session!.user.id, status: "REGISTERED", location: rest.pickupLocation },
    });
    return created;
  });

  return apiOk(parcel, 201);
}

// FR-06 / UC-P02: list parcels (own, for a customer; all, for ops staff).
export async function GET(request: NextRequest) {
  const { session, error } = await requireRole();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const status = searchParams.get("status");

  const where = {
    ...(session!.user.role === "CUSTOMER" ? { sender: { userId: session!.user.id } } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.parcel.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    prisma.parcel.count({ where }),
  ]);

  return apiOk(paginated(items, total, page, pageSize));
}
