/**
 * FR-27: settlement bank/mobile money account names must match the
 * verified legal/business name before payouts are enabled.
 *
 * This is a naive normalized-token comparison, adequate for flagging
 * obvious mismatches in a scaffold. Production should call a bank-name
 * verification API (many mobile money/bank rails expose "account name
 * enquiry" endpoints) rather than trusting free-text input.
 */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function bankNameMatches(legalName: string, bankAccountName: string): boolean {
  const a = normalize(legalName);
  const b = normalize(bankAccountName);
  if (!a || !b) return false;
  if (a === b) return true;

  const aTokens = new Set(a.split(" "));
  const bTokens = b.split(" ");
  const overlap = bTokens.filter((t) => aTokens.has(t)).length;
  return overlap / Math.max(aTokens.size, bTokens.length) >= 0.6;
}
