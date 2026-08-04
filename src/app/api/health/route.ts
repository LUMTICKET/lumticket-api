import { prisma } from "@/lib/prisma";
import { apiError, apiOk } from "@/lib/api-response";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return apiOk({ status: "ok", db: "connected", time: new Date().toISOString() });
  } catch (err) {
    return apiError(503, "DB_UNAVAILABLE", "Database connection failed.", String(err));
  }
}
