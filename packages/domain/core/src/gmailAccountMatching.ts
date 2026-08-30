/**
 * Gmail candidate -> Spencare account matching (Phase 19 reconnaissance
 * §18, Part 17). Pure, zero I/O -- the caller (domain-application) fetches
 * the user's accounts and passes them in.
 *
 * HONEST SCHEMA CONSTRAINT (documented, not silently worked around):
 * `accounts` (database-architecture.md) has no structured card/account
 * -number column -- only a free-text `name`. There is therefore no
 * reliable structured signal to match a Gmail-extracted card last-four
 * against; this function can only match when the last-four literally
 * appears in the account's own name (a real but not guaranteed
 * possibility -- e.g. a user named their account "HDFC Card 4242"), or
 * when the sender's institution keyword appears in the account name.
 * Per Part 17/46 ("if ambiguous, do NOT guess... require review"), any
 * case that isn't a single unambiguous match returns
 * `accountMatchRequired: true` rather than guessing among candidates --
 * in practice this means most Gmail candidates will need the user to
 * assign an account manually in the review UI, which is the correct,
 * safe default given this schema limitation (see the Phase 19 final
 * report's disclosed limitation, not a hidden gap).
 */

export interface AccountMatchCandidate {
  id: string;
  name: string;
  type: "bank" | "cash" | "credit_card" | "investment";
  isArchived: boolean;
}

export interface GmailAccountMatchInput {
  senderEmail: string | null;
  extractedLastFour: string | null;
}

export interface GmailAccountMatchResult {
  accountId: string | null;
  accountMatchRequired: boolean;
}

// A handful of common institution-name fragments derivable from a sender
// domain, used only as a last-four-less fallback signal. Deliberately
// small and conservative -- a false match here would silently attribute
// a transaction to the wrong account, which is worse than requiring
// review.
const DOMAIN_TO_INSTITUTION_KEYWORD: Record<string, string> = {
  hdfcbank: "hdfc",
  icicibank: "icici",
  axisbank: "axis",
  kotak: "kotak",
  sbi: "sbi",
  yesbank: "yes",
  idfcfirstbank: "idfc",
  indusind: "indusind",
  americanexpress: "amex",
  amex: "amex",
};

function eligibleAccounts(accounts: readonly AccountMatchCandidate[]): AccountMatchCandidate[] {
  return accounts.filter((a) => !a.isArchived && (a.type === "bank" || a.type === "cash" || a.type === "credit_card"));
}

export function matchGmailAccount(input: GmailAccountMatchInput, accounts: readonly AccountMatchCandidate[]): GmailAccountMatchResult {
  const candidates = eligibleAccounts(accounts);

  if (input.extractedLastFour) {
    const byLastFour = candidates.filter((a) => a.name.includes(input.extractedLastFour!));
    if (byLastFour.length === 1) return { accountId: byLastFour[0]!.id, accountMatchRequired: false };
    if (byLastFour.length > 1) return { accountId: null, accountMatchRequired: true }; // ambiguous -- never guess among several
  }

  const domain = input.senderEmail?.split("@")[1]?.toLowerCase() ?? "";
  const institutionKeyword = Object.entries(DOMAIN_TO_INSTITUTION_KEYWORD).find(([fragment]) => domain.includes(fragment))?.[1];
  if (institutionKeyword) {
    const byInstitution = candidates.filter((a) => a.name.toLowerCase().includes(institutionKeyword));
    if (byInstitution.length === 1) return { accountId: byInstitution[0]!.id, accountMatchRequired: false };
  }

  return { accountId: null, accountMatchRequired: true };
}
