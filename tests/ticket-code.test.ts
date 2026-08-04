import { describe, expect, it, beforeAll } from "vitest";
import { generateTicketCode, verifyTicketCode, generateBookingRef } from "@/lib/ticket-code";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

describe("ticket-code (FR-02: secure, hard-to-forge QR tickets)", () => {
  it("round-trips a generated code back to its bookingId", () => {
    const bookingId = "11111111-1111-1111-1111-111111111111";
    const code = generateTicketCode(bookingId);
    expect(verifyTicketCode(code)).toEqual({ bookingId });
  });

  it("rejects a tampered signature", () => {
    const code = generateTicketCode("11111111-1111-1111-1111-111111111111");
    const [bookingId] = code.split(".");
    const tampered = `${bookingId}.${"0".repeat(32)}`;
    expect(verifyTicketCode(tampered)).toBeNull();
  });

  it("rejects a code for a different bookingId reusing another signature", () => {
    const codeA = generateTicketCode("11111111-1111-1111-1111-111111111111");
    const [, signatureA] = codeA.split(".");
    const forged = `22222222-2222-2222-2222-222222222222.${signatureA}`;
    expect(verifyTicketCode(forged)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyTicketCode("not-a-valid-code")).toBeNull();
    expect(verifyTicketCode("")).toBeNull();
  });
});

describe("generateBookingRef", () => {
  it("produces unique, prefixed references", () => {
    const refs = new Set(Array.from({ length: 50 }, () => generateBookingRef()));
    expect(refs.size).toBe(50);
    for (const ref of refs) {
      expect(ref.startsWith("BK-")).toBe(true);
    }
  });
});
