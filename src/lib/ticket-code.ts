import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * FR-02: generate a unique, secure QR-code ticket that cannot easily be
 * forged. The code embeds the bookingId plus an HMAC signature so the
 * Scanning & Validation App can verify authenticity offline (NFR-05,
 * NFR-OF1) as long as it has been provisioned with TICKET_SIGNING_SECRET —
 * it does not need a live connection to re-derive the signature.
 */
function secret() {
  return process.env.AUTH_SECRET ?? "dev-secret-change-me";
}

export function generateTicketCode(bookingId: string): string {
  const signature = createHmac("sha256", secret()).update(bookingId).digest("hex").slice(0, 32);
  return `${bookingId}.${signature}`;
}

export function verifyTicketCode(code: string): { bookingId: string } | null {
  const parts = code.split(".");
  if (parts.length !== 2) return null;
  const [bookingId, signature] = parts;

  const expected = createHmac("sha256", secret()).update(bookingId).digest("hex").slice(0, 32);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  return { bookingId };
}

export function generateBookingRef(prefix = "BK"): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
}
