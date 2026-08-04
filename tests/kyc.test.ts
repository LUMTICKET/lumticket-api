import { describe, expect, it } from "vitest";
import { bankNameMatches } from "@/lib/kyc";

describe("bankNameMatches (FR-27: settlement account name must match legal name)", () => {
  it("matches identical names regardless of case/punctuation", () => {
    expect(bankNameMatches("Sunrise Coaches Ltd", "SUNRISE COACHES LTD")).toBe(true);
  });

  it("matches when word order differs", () => {
    expect(bankNameMatches("Sunrise Coaches Ltd", "Coaches Sunrise Ltd")).toBe(true);
  });

  it("rejects an unrelated account name (the SRS Section 11 example)", () => {
    expect(bankNameMatches("Mzuzu Corner Shop", "John Banda Personal Account")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(bankNameMatches("Mzuzu Corner Shop", "")).toBe(false);
  });
});
