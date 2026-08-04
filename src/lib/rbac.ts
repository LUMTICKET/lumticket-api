import { auth } from "@/lib/auth";
import { Role } from "@/generated/prisma/enums";
import { apiError } from "@/lib/api-response";

export type AuthedSession = {
  user: { id: string; role: Role; tenantId: string | null };
};

/**
 * Enforces RBAC at the API level (NFR-04, FR-15). Every protected route
 * handler should call this first and bail out on the returned error
 * response before touching the database.
 */
export async function requireRole(...allowed: Role[]) {
  const session = await auth();

  if (!session?.user) {
    return { session: null, error: apiError(401, "UNAUTHENTICATED", "Sign-in required.") };
  }

  if (allowed.length > 0 && !allowed.includes(session.user.role)) {
    return {
      session: null,
      error: apiError(403, "FORBIDDEN", "Your role does not have access to this resource."),
    };
  }

  return { session: session as AuthedSession, error: null };
}
