import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk, paginated, parsePagination } from "@/lib/api-response";

const createSchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  scheduleDatetime: z.coerce.date(),
  price: z.coerce.number().positive(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  seatNumbers: z.array(z.string()).min(1),
});

// FR-01 / UC-B01: public route search with live seat-availability counts.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const origin = searchParams.get("origin");
  const destination = searchParams.get("destination");
  const date = searchParams.get("date"); // YYYY-MM-DD

  const dateFilter = date
    ? {
        gte: new Date(`${date}T00:00:00.000Z`),
        lt: new Date(`${date}T23:59:59.999Z`),
      }
    : undefined;

  const where = {
    status: "SCHEDULED" as const,
    ...(origin ? { origin: { contains: origin, mode: "insensitive" as const } } : {}),
    ...(destination ? { destination: { contains: destination, mode: "insensitive" as const } } : {}),
    ...(dateFilter ? { scheduleDatetime: dateFilter } : {}),
  };

  const [trips, total] = await Promise.all([
    prisma.routeTrip.findMany({
      where,
      skip,
      take,
      orderBy: { scheduleDatetime: "asc" },
      include: {
        operator: { select: { id: true, legalName: true } },
        vehicle: { select: { type: true, capacity: true } },
        _count: { select: { seats: { where: { status: "AVAILABLE" } } } },
      },
    }),
    prisma.routeTrip.count({ where }),
  ]);

  return apiOk(paginated(trips, total, page, pageSize));
}

// Operator staff create scheduled trips + seat inventory.
export async function POST(request: NextRequest) {
  const { session, error } = await requireRole("OPERATIONS_MANAGER", "ADMINISTRATOR");
  if (error) return error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { seatNumbers, ...tripFields } = parsed.data;

  const operatorId = session!.user.tenantId;
  if (!operatorId) {
    return apiError(422, "NO_TENANT", "This user is not attached to an operator tenant.");
  }

  const trip = await prisma.$transaction(async (tx) => {
    const created = await tx.routeTrip.create({ data: { ...tripFields, operatorId } });
    await tx.seat.createMany({
      data: seatNumbers.map((seatNo) => ({ tripId: created.id, seatNo })),
    });
    return created;
  });

  return apiOk(trip, 201);
}
