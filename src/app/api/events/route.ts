import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk, paginated, parsePagination } from "@/lib/api-response";

const ticketTypeSchema = z.object({
  name: z.string().min(1),
  price: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().int().positive(),
});

const bodySchema = z.object({
  name: z.string().min(1),
  venue: z.string().min(1),
  eventDate: z.coerce.date(),
  capacity: z.coerce.number().int().positive().optional(),
  ticketTypes: z.array(ticketTypeSchema).min(1),
});

// UC-E01 / FR-01: organizer creates an event with ticket types and pricing.
export async function POST(request: NextRequest) {
  const { session, error } = await requireRole("OPERATIONS_MANAGER", "ADMINISTRATOR");
  if (error) return error;

  const organizerId = session!.user.tenantId;
  if (!organizerId) {
    return apiError(422, "NO_TENANT", "This user is not attached to an event-organizer tenant.");
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { ticketTypes, ...eventFields } = parsed.data;

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: { ...eventFields, organizerId, status: "DRAFT" },
    });
    await tx.ticketType.createMany({
      data: ticketTypes.map((t) => ({ ...t, eventId: created.id })),
    });
    return created;
  });

  return apiOk(event, 201);
}

// Public listing of published events.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const name = searchParams.get("name");

  const where = {
    status: "PUBLISHED" as const,
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.event.findMany({
      where,
      skip,
      take,
      orderBy: { eventDate: "asc" },
      include: { organizer: { select: { legalName: true } }, ticketTypes: true },
    }),
    prisma.event.count({ where }),
  ]);

  return apiOk(paginated(items, total, page, pageSize));
}
