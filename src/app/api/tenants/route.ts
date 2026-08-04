import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk, paginated, parsePagination } from "@/lib/api-response";
import type { Prisma } from "@/generated/prisma/client";

const createSchema = z.object({
  type: z.enum(["BUS", "COURIER", "EVENT", "RETAIL"]),
  legalName: z.string().min(1),
  country: z.string().min(1),
  commissionConfig: z.record(z.string(), z.unknown()).optional(),
});

// FR-14: Administrators configure merchant/operator/agent records.
export async function POST(request: NextRequest) {
  const { error } = await requireRole("ADMINISTRATOR");
  if (error) return error;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }

  const tenant = await prisma.tenant.create({
    data: {
      ...parsed.data,
      commissionConfig: parsed.data.commissionConfig as Prisma.InputJsonValue | undefined,
      status: "INACTIVE", // activated only after KYC approval (FR-25)
    },
  });

  return apiOk(tenant, 201);
}

export async function GET(request: NextRequest) {
  const { error } = await requireRole("ADMINISTRATOR");
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const where = {
    ...(type ? { type: type as never } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
    prisma.tenant.count({ where }),
  ]);

  return apiOk(paginated(items, total, page, pageSize));
}
