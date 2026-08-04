import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { Prisma } from "@/generated/prisma/client";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * Wraps a booking-and-payment route handler with idempotency-key handling
 * (FR-23, API-03). The caller must send an `Idempotency-Key` header; a
 * retried request with the same key on the same endpoint replays the
 * original stored response instead of re-running the handler.
 */
export async function withIdempotency(
  request: NextRequest,
  endpoint: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required for this endpoint.");
  }

  try {
    await prisma.idempotencyKey.create({ data: { key, endpoint } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
      const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
      if (existing?.responseBody && existing.statusCode) {
        return NextResponse.json(existing.responseBody, { status: existing.statusCode });
      }
      return apiError(409, "REQUEST_IN_PROGRESS", "A request with this Idempotency-Key is already being processed.");
    }
    throw err;
  }

  const response = await handler();
  const body = await response.clone().json().catch(() => null);

  await prisma.idempotencyKey.update({
    where: { key },
    data: { statusCode: response.status, responseBody: body },
  });

  return response;
}
