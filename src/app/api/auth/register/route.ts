import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { apiError, apiOk } from "@/lib/api-response";

const bodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(8),
});

// Public endpoint — self-service Customer registration (Section 3, "Customer" role).
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { name, email, phone, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return apiError(409, "EMAIL_TAKEN", "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(password);

  const customer = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { role: "CUSTOMER", name, email, phone, passwordHash },
    });
    return tx.customer.create({
      data: { userId: user.id, fullName: name, email, phone },
    });
  });

  return apiOk({ id: customer.id, fullName: customer.fullName, email: customer.email }, 201);
}
