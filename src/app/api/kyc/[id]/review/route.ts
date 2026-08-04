import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";
import { bankNameMatches } from "@/lib/kyc";

const bodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "RE_VERIFICATION_REQUIRED"]),
  notes: z.string().optional(),
  reVerificationDue: z.coerce.date().optional(),
});

// UC-K02 / FR-25 / FR-27 / FR-31: review a submitted KYC record.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: kycId } = await params;
  const { session, error } = await requireRole("KYC_REVIEWER", "ADMINISTRATOR");
  if (error) return error;

  const kyc = await prisma.kycVerification.findUnique({ where: { id: kycId } });
  if (!kyc) return apiError(404, "KYC_NOT_FOUND", "KYC verification record not found.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { decision, notes, reVerificationDue } = parsed.data;

  // FR-27: block settlement activation on a bank/mobile-money name mismatch,
  // per the SRS Section 11 acceptance-criteria example.
  if (decision === "APPROVED") {
    const accountRef = kyc.bankAccountRef ?? kyc.mobileMoneyRef;
    if (!accountRef || !bankNameMatches(kyc.legalName, accountRef)) {
      await prisma.kycAuditLog.create({
        data: {
          kycVerificationId: kyc.id,
          status: "RE_VERIFICATION_REQUIRED",
          reviewerId: session!.user.id,
          notes: "Settlement account name does not match verified legal name — activation blocked.",
        },
      });
      return apiError(
        422,
        "BANK_NAME_MISMATCH",
        "Settlement account name does not match the verified legal name; activation blocked pending manual review.",
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.kycVerification.update({
      where: { id: kyc.id },
      data: {
        verificationStatus: decision,
        verifiedById: session!.user.id,
        verifiedAt: decision === "APPROVED" ? new Date() : null,
        reVerificationDue: reVerificationDue ?? null,
      },
    });

    await tx.kycAuditLog.create({
      data: { kycVerificationId: kyc.id, status: decision, reviewerId: session!.user.id, notes },
    });

    if (decision === "APPROVED") {
      await tx.tenant.update({ where: { id: kyc.tenantId }, data: { status: "ACTIVE" } });
    } else if (decision === "REJECTED") {
      await tx.tenant.update({ where: { id: kyc.tenantId }, data: { status: "SUSPENDED" } });
    }

    return updated;
  });

  return apiOk(result);
}
