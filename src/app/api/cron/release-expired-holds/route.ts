import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk } from "@/lib/api-response";

/**
 * FR-22: authoritative sweep that returns expired seat holds to
 * "available". Serverless Next.js has no long-running background worker,
 * so this endpoint is meant to be invoked by an external scheduler
 * (Vercel Cron, a cloud scheduler, or a simple system cron job hitting it
 * every 30-60s) rather than run in-process. See docs/API.md for wiring.
 *
 * Real-time "notify the customer's session" (FR-22) needs a push channel
 * (websocket/SSE) which is out of scope for this scaffold — noted as a
 * follow-up in docs/ARCHITECTURE.md.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return apiError(401, "UNAUTHORIZED", "Missing or invalid cron secret.");
  }

  const result = await prisma.seat.updateMany({
    where: { status: "HELD", holdExpiresAt: { lt: new Date() } },
    data: { status: "AVAILABLE", holdExpiresAt: null },
  });

  return apiOk({ released: result.count });
}
