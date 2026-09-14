import { describe, expect, it } from "vitest";
import { deriveCardPaymentReserveState, type AccountLike, type CreditCardPaymentSourceRow } from "./creditCardPaymentSourcesRepo.js";

const makeAccount = (overrides: Partial<AccountLike> & Pick<AccountLike, "id" | "type">): AccountLike => ({
  name: "Account",
  credit_used_minor: null,
  ...overrides,
});

const makeSource = (creditCardAccountId: string, paymentAccountId: string): CreditCardPaymentSourceRow => ({
  id: "src-" + creditCardAccountId,
  user_id: "user-1",
  credit_card_account_id: creditCardAccountId,
  payment_account_id: paymentAccountId,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

// ---------------------------------------------------------------------------
// Canonical regression fixture (spec Phase 22):
//
//   HDFC Bank    balance = 8,000,000  (₹80,000)
//   IDFC Bank    balance = 2,000,000  (₹20,000)
//   ICICI Card   credit_used = 2,000,000  (₹20,000)  payment = HDFC
//   Slice Card   credit_used = 1,000,000  (₹10,000)  payment = IDFC
//
// Expected:
//   HDFC card reserve  = ₹20,000
//   IDFC card reserve  = ₹10,000
//   Global total       = ₹30,000
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — canonical regression fixture", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const idfc = makeAccount({ id: "idfc", type: "bank", name: "IDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI Credit Card", credit_used_minor: 2_000_000 });
  const slice = makeAccount({ id: "slice", type: "credit_card", name: "Slice", credit_used_minor: 1_000_000 });
  const accounts = [hdfc, idfc, icici, slice];
  const sources = [makeSource("icici", "hdfc"), makeSource("slice", "idfc")];

  const state = deriveCardPaymentReserveState(accounts, sources);

  it("global totalMinor equals sum of all configured card outstanding balances", () => {
    expect(state.totalMinor).toBe(3_000_000); // 2,000,000 + 1,000,000
  });

  it("HDFC reserve equals ICICI outstanding (₹20,000)", () => {
    expect(state.perPaymentAccount["hdfc"]).toBe(2_000_000);
  });

  it("IDFC reserve equals Slice outstanding (₹10,000)", () => {
    expect(state.perPaymentAccount["idfc"]).toBe(1_000_000);
  });

  it("perCard contains one entry per configured card", () => {
    expect(state.perCard).toHaveLength(2);
  });

  it("ICICI card detail is correct", () => {
    const detail = state.perCard.find((d) => d.creditCardAccountId === "icici");
    expect(detail).toBeDefined();
    expect(detail!.outstandingMinor).toBe(2_000_000);
    expect(detail!.reservedMinor).toBe(2_000_000);
    expect(detail!.paymentAccountId).toBe("hdfc");
    expect(detail!.creditCardName).toBe("ICICI Credit Card");
    expect(detail!.paymentAccountName).toBe("HDFC Bank");
  });

  it("Slice card detail is correct", () => {
    const detail = state.perCard.find((d) => d.creditCardAccountId === "slice");
    expect(detail).toBeDefined();
    expect(detail!.outstandingMinor).toBe(1_000_000);
    expect(detail!.reservedMinor).toBe(1_000_000);
    expect(detail!.paymentAccountId).toBe("idfc");
  });
});

// ---------------------------------------------------------------------------
// Phase 22 transaction semantics test: after ₹5,000 ICICI purchase
//
//   ICICI outstanding: 2,000,000 -> 2,500,000 (₹25,000)
//   HDFC reserve should become ₹25,000
//   IDFC reserve stays ₹10,000
//   Global total: ₹35,000
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — after ₹5,000 ICICI purchase", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const idfc = makeAccount({ id: "idfc", type: "bank", name: "IDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI Credit Card", credit_used_minor: 2_500_000 });
  const slice = makeAccount({ id: "slice", type: "credit_card", name: "Slice", credit_used_minor: 1_000_000 });
  const accounts = [hdfc, idfc, icici, slice];
  const sources = [makeSource("icici", "hdfc"), makeSource("slice", "idfc")];

  const state = deriveCardPaymentReserveState(accounts, sources);

  it("HDFC reserve increased to ₹25,000 (follows ICICI outstanding)", () => {
    expect(state.perPaymentAccount["hdfc"]).toBe(2_500_000);
  });

  it("IDFC reserve unchanged at ₹10,000", () => {
    expect(state.perPaymentAccount["idfc"]).toBe(1_000_000);
  });

  it("global total is ₹35,000", () => {
    expect(state.totalMinor).toBe(3_500_000);
  });
});

// ---------------------------------------------------------------------------
// Phase 22 transfer semantics test: after ₹10,000 HDFC -> ICICI transfer
//
//   HDFC balance: 8,000,000 -> 7,000,000 (not tracked here -- affects STS via balance)
//   ICICI outstanding: 2,500,000 -> 1,500,000 (₹15,000)
//   HDFC card reserve: ₹25,000 -> ₹15,000
//   Global total: ₹25,000
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — after ₹10,000 HDFC -> ICICI transfer (payment)", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const idfc = makeAccount({ id: "idfc", type: "bank", name: "IDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI Credit Card", credit_used_minor: 1_500_000 });
  const slice = makeAccount({ id: "slice", type: "credit_card", name: "Slice", credit_used_minor: 1_000_000 });
  const accounts = [hdfc, idfc, icici, slice];
  const sources = [makeSource("icici", "hdfc"), makeSource("slice", "idfc")];

  const state = deriveCardPaymentReserveState(accounts, sources);

  it("HDFC reserve decreased to ₹15,000 (ICICI outstanding reduced by payment)", () => {
    expect(state.perPaymentAccount["hdfc"]).toBe(1_500_000);
  });

  it("IDFC reserve unchanged at ₹10,000", () => {
    expect(state.perPaymentAccount["idfc"]).toBe(1_000_000);
  });

  it("global total is ₹25,000", () => {
    expect(state.totalMinor).toBe(2_500_000);
  });
});

// ---------------------------------------------------------------------------
// Phase 10: no payment account configured
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — Phase 10: no payment account configured", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI", credit_used_minor: 2_000_000 });
  const accounts = [hdfc, icici];

  it("zero reserve when no payment source is configured", () => {
    const state = deriveCardPaymentReserveState(accounts, []);
    expect(state.totalMinor).toBe(0);
    expect(state.perCard).toHaveLength(0);
    expect(Object.keys(state.perPaymentAccount)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 9: payment source change (HDFC -> IDFC)
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — Phase 9: payment source change", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const idfc = makeAccount({ id: "idfc", type: "bank", name: "IDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI", credit_used_minor: 2_000_000 });
  const accounts = [hdfc, idfc, icici];

  it("HDFC reserve when ICICI payment account is HDFC", () => {
    const state = deriveCardPaymentReserveState(accounts, [makeSource("icici", "hdfc")]);
    expect(state.perPaymentAccount["hdfc"]).toBe(2_000_000);
    expect(state.perPaymentAccount["idfc"]).toBeUndefined();
    expect(state.totalMinor).toBe(2_000_000);
  });

  it("IDFC reserve after switching ICICI payment account to IDFC", () => {
    const state = deriveCardPaymentReserveState(accounts, [makeSource("icici", "idfc")]);
    expect(state.perPaymentAccount["idfc"]).toBe(2_000_000);
    expect(state.perPaymentAccount["hdfc"]).toBeUndefined();
    expect(state.totalMinor).toBe(2_000_000);
  });

  it("global reserve unchanged by the switch (still ₹20,000)", () => {
    const before = deriveCardPaymentReserveState(accounts, [makeSource("icici", "hdfc")]);
    const after = deriveCardPaymentReserveState(accounts, [makeSource("icici", "idfc")]);
    expect(before.totalMinor).toBe(after.totalMinor);
  });
});

// ---------------------------------------------------------------------------
// Phase 11: reserve exceeds bank balance (NOT capped)
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — Phase 11: reserve exceeds bank cash", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI", credit_used_minor: 1_500_000 });
  const accounts = [hdfc, icici];
  const sources = [makeSource("icici", "hdfc")];

  it("reserve is reported at the full outstanding amount even if it exceeds the bank balance", () => {
    // HDFC has only ₹10,000 but ICICI outstanding is ₹15,000 -- reserve is ₹15,000, not capped
    const state = deriveCardPaymentReserveState(accounts, sources);
    expect(state.perPaymentAccount["hdfc"]).toBe(1_500_000);
    expect(state.totalMinor).toBe(1_500_000);
  });
});

// ---------------------------------------------------------------------------
// Multiple cards paying from one bank account
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — multiple cards from one bank", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI", credit_used_minor: 2_000_000 });
  const slice = makeAccount({ id: "slice", type: "credit_card", name: "Slice", credit_used_minor: 1_000_000 });
  const amazon = makeAccount({ id: "amazon", type: "credit_card", name: "Amazon Pay", credit_used_minor: 500_000 });
  const accounts = [hdfc, icici, slice, amazon];
  const sources = [makeSource("icici", "hdfc"), makeSource("slice", "hdfc"), makeSource("amazon", "hdfc")];

  const state = deriveCardPaymentReserveState(accounts, sources);

  it("HDFC reserve equals sum of all linked card outstanding balances", () => {
    expect(state.perPaymentAccount["hdfc"]).toBe(3_500_000); // 2M + 1M + 0.5M
  });

  it("global total equals HDFC reserve (all cards point to same bank)", () => {
    expect(state.totalMinor).toBe(3_500_000);
  });

  it("perCard has three entries", () => {
    expect(state.perCard).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Zero-balance card
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — zero outstanding balance", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI", credit_used_minor: 0 });
  const accounts = [hdfc, icici];
  const sources = [makeSource("icici", "hdfc")];

  it("reserve is zero when card outstanding is zero", () => {
    const state = deriveCardPaymentReserveState(accounts, sources);
    expect(state.totalMinor).toBe(0);
    expect(state.perPaymentAccount["hdfc"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Archived / missing payment account
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — missing payment account (archived)", () => {
  // When a bank account is archived, it won't be in the accounts list.
  // The payment source should be silently skipped -- no reserve for that card.
  const icici = makeAccount({ id: "icici", type: "credit_card", name: "ICICI", credit_used_minor: 2_000_000 });
  const accounts = [icici]; // HDFC not included (archived)
  const sources = [makeSource("icici", "hdfc")];

  it("skips the source when payment account is not found", () => {
    const state = deriveCardPaymentReserveState(accounts, sources);
    expect(state.totalMinor).toBe(0);
    expect(state.perCard).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Archived / missing credit card
// ---------------------------------------------------------------------------
describe("deriveCardPaymentReserveState — missing credit card (archived)", () => {
  const hdfc = makeAccount({ id: "hdfc", type: "bank", name: "HDFC Bank" });
  const accounts = [hdfc]; // ICICI not included (archived)
  const sources = [makeSource("icici", "hdfc")];

  it("skips the source when credit card is not found", () => {
    const state = deriveCardPaymentReserveState(accounts, sources);
    expect(state.totalMinor).toBe(0);
    expect(state.perCard).toHaveLength(0);
  });
});
