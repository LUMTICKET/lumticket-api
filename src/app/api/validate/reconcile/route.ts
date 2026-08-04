import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

const bodySchema = z.object({ validationLogId: z.string().uuid() });

// FR-10: manual-validation fallback records must be reconciled against
// digital records after the event/trip.
export async function POST(request: NextRequest) {
  const { error } = await requireRole("OPERATIONS_MANAGER", "ADMINISTRATOR");
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }

  const log = await prisma.validationLog.update({
    where: { id: parsed.data.validationLogId },
    data: { reconciledAt: new Date() },
  });

  return apiOk(log);
}
