import { prisma } from "@/lib/prisma";
import type { AuthedSession } from "@/lib/rbac";

/**
 * Resolves which Customer a booking/parcel is being made for. Customers act
 * for themselves; staff (booking officers, POS agents, admins) act on
 * behalf of a walk-in customer identified by `bodyCustomerId`.
 */
export async function resolveCustomerId(
  session: AuthedSession,
  bodyCustomerId?: string,
): Promise<{ customerId: string } | { error: "SELF_LOOKUP_FAILED" | "CUSTOMER_ID_REQUIRED" | "CUSTOMER_NOT_FOUND" }> {
  if (session.user.role === "CUSTOMER") {
    const customer = await prisma.customer.findUnique({ where: { userId: session.user.id } });
    if (!customer) return { error: "SELF_LOOKUP_FAILED" };
    return { customerId: customer.id };
  }

  if (!bodyCustomerId) return { error: "CUSTOMER_ID_REQUIRED" };
  const customer = await prisma.customer.findUnique({ where: { id: bodyCustomerId } });
  if (!customer) return { error: "CUSTOMER_NOT_FOUND" };
  return { customerId: customer.id };
}
