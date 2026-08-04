import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { apiError, apiOk } from "@/lib/api-response";
import { verifyTicketCode } from "@/lib/ticket-code";

const bodySchema = z.object({
  ticketOrParcelType: z.enum(["TICKET", "PARCEL"]),
  code: z.string().optional(), // QR payload for TICKET
  parcelId: z.string().uuid().optional(), // scanned barcode for PARCEL
  deviceId: z.string().min(1),
  mode: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
  // Set by the Scanning/Driver app when replaying a validation that was
  // queued while offline (NFR-OF1/OF2), so the log reflects the real scan
  // time rather than the later sync time.
  clientTimestamp: z.coerce.date().optional(),
});

// FR-08, FR-09, FR-10; UC-B04, UC-E02; NFR-05, NFR-OF1/OF2.
// Validates a ticket or parcel scan and always logs the attempt — including
// invalid, duplicate, and manual-fallback scans — for audit + reconciliation.
export async function POST(request: NextRequest) {
  const { session, error } = await requireRole("TICKET_INSPECTOR", "DRIVER", "ADMINISTRATOR");
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "VALIDATION_ERROR", "Invalid request body.", parsed.error.flatten());
  }
  const { ticketOrParcelType, code, parcelId, deviceId, mode, clientTimestamp } = parsed.data;

  const baseLogData = {
    ticketOrParcelType,
    actorId: session!.user.id,
    mode,
    deviceId,
    ...(clientTimestamp ? { createdAt: clientTimestamp } : {}),
  };

  if (ticketOrParcelType === "TICKET") {
    if (!code) return apiError(400, "CODE_REQUIRED", "A ticket QR code is required.");

    const verified = verifyTicketCode(code);
    if (!verified) {
      await prisma.validationLog.create({ data: { ...baseLogData, result: "INVALID" } });
      return apiOk({ result: "INVALID", reason: "Signature could not be verified." }, 200);
    }

    const booking = await prisma.booking.findUnique({ where: { id: verified.bookingId } });
    if (!booking || booking.status !== "CONFIRMED") {
      await prisma.validationLog.create({
        data: { ...baseLogData, bookingId: verified.bookingId, result: "INVALID" },
      });
      return apiOk({ result: "INVALID", reason: "Ticket is not a confirmed booking." });
    }

    const priorValid = await prisma.validationLog.findFirst({
      where: { bookingId: booking.id, result: "VALID" },
    });
    if (priorValid) {
      await prisma.validationLog.create({
        data: { ...baseLogData, bookingId: booking.id, result: "INVALID" },
      });
      return apiOk({
        result: "INVALID",
        reason: "DUPLICATE_USE",
        message: "This ticket was already validated — flagged as a duplicate-use conflict, not silently allowed.",
        firstValidatedAt: priorValid.createdAt,
      });
    }

    const log = await prisma.validationLog.create({
      data: { ...baseLogData, bookingId: booking.id, result: "VALID" },
    });
    return apiOk({ result: "VALID", validationLogId: log.id, bookingId: booking.id });
  }

  // PARCEL
  if (!parcelId) return apiError(400, "PARCEL_ID_REQUIRED", "A parcel id is required.");
  const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });
  if (!parcel) {
    await prisma.validationLog.create({ data: { ...baseLogData, parcelId, result: "INVALID" } });
    return apiOk({ result: "INVALID", reason: "Parcel not found." });
  }

  const log = await prisma.validationLog.create({
    data: { ...baseLogData, parcelId, result: "VALID" },
  });
  return apiOk({ result: "VALID", validationLogId: log.id, parcelId });
}
