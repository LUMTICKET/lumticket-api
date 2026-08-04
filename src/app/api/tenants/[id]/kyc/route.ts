import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";

const documentSchema = z.object({
  documentType: z.string().min(1),
  documentRef: z.string().min(1),
  expiryDate: z.coerce.date().optional(),
});

const bodySchema = z.object({
  legalName: z.string().min(1),
  idDocumentRef: z.string().optional(),
  businessRegRef: z.string().optional(),
  tpinRef: z.string().optional(),
  bankAccountRef: z.string().optional(),
  mobileMoneyRef: z.string().optional(),
  documents: z.array(documentSchema).default([]),
});

// UC-K01 / FR-25 / FR-26: submit KYC/KYB for a tenant before activation.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const { session, error } = await requireRole();
  if (error) return error;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return apiError(404, "TENANT_NOT_FOUND", "Tenant not found.");

  const isOwnStaff = session!.user.tenantId === tenantId;
  const isAdmin = session!.user.role === "ADMINISTRATOR";
  if (!isOwnStaff && !isAdmin) {
    return apiError(403, "FORBIDDEN", "You cannot submit KYC for a different tenant.");
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { documents, ...kycFields } = parsed.data;

  // Section 6.3: retail/POS agents carry the highest risk tier by default
  // due to direct cash handling; everyone else starts at MEDIUM.
  const riskTier = tenant.type === "RETAIL" ? "HIGH" : "MEDIUM";

  const kyc = await prisma.$transaction(async (tx) => {
    const record = await tx.kycVerification.upsert({
      where: { tenantId },
      create: {
        tenantId,
        accountType: tenant.type,
        riskTier,
        verificationStatus: "PENDING",
        ...kycFields,
      },
      update: {
        verificationStatus: "PENDING",
        verifiedById: null,
        verifiedAt: null,
        ...kycFields,
      },
    });

    if (documents.length > 0) {
      await tx.kycDocument.createMany({
        data: documents.map((d) => ({ ...d, kycVerificationId: record.id })),
      });
    }

    await tx.kycAuditLog.create({
      data: { kycVerificationId: record.id, status: "PENDING", notes: "KYC submitted for review" },
    });

    return record;
  });

  return apiOk(kyc, 201);
}
