import { describe, expect, it } from "vitest";
import { derivePreparationStatus } from "./preparationStatus.js";

const today = "2026-10-03";

describe("derivePreparationStatus (payment and preparation are independent state machines)", () => {
  it("YouTube acceptance: preparation date passed + fully protected => Ready, never Overdue", () => {
    // Spec: prep 1 Oct, payment 27 Oct, protected 149 / 149, today 3 Oct.
    const r = derivePreparationStatus({
      preparationDate: "2026-10-01",
      todayIso: today,
      requiredMinor: 14900,
      protectedMinor: 14900,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("ready");
    expect(r.remainingMinor).toBe(0);
    expect(r.partial).toBe(false);
  });

  it("Netflix acceptance: preparation date passed + nothing protected + payment future => preparation_behind, NOT payment overdue", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-01",
      todayIso: today,
      requiredMinor: 9950,
      protectedMinor: 0,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("preparation_behind");
    expect(r.remainingMinor).toBe(9950);
    expect(r.partial).toBe(false);
  });

  it("Jio acceptance: preparation date passed + partially protected => preparation_behind + partial flag", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-01",
      todayIso: today,
      requiredMinor: 89900,
      protectedMinor: 29967,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("preparation_behind");
    expect(r.remainingMinor).toBe(89900 - 29967);
    expect(r.partial).toBe(true);
  });

  it("preparation date in the future + nothing protected => preparation_due", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-10",
      todayIso: today,
      requiredMinor: 50000,
      protectedMinor: 0,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("preparation_due");
    expect(r.remainingMinor).toBe(50000);
  });

  it("preparation date in the future + fully protected => ready (early is still ready)", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-10",
      todayIso: today,
      requiredMinor: 50000,
      protectedMinor: 50000,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("ready");
  });

  it("preparation date in the future + partially protected => preparation_due + partial", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-10",
      todayIso: today,
      requiredMinor: 50000,
      protectedMinor: 20000,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("preparation_due");
    expect(r.partial).toBe(true);
  });

  it("preparation date is today + nothing protected => preparation_due (not behind)", () => {
    const r = derivePreparationStatus({
      preparationDate: today,
      todayIso: today,
      requiredMinor: 10000,
      protectedMinor: 0,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("preparation_due");
    expect(r.daysUntilPreparation).toBe(0);
  });

  it("current occurrence already paid => payment_already_paid, regardless of protection figures", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-01",
      todayIso: today,
      requiredMinor: 10000,
      protectedMinor: 0,
      paymentAlreadyPaid: true,
    });
    expect(r.kind).toBe("payment_already_paid");
    expect(r.remainingMinor).toBe(0);
  });

  it("commitment with no preparation plan => not_applicable", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-01",
      todayIso: today,
      requiredMinor: 0,
      protectedMinor: 0,
      paymentAlreadyPaid: false,
      preparationNotPlanned: true,
    });
    expect(r.kind).toBe("not_applicable");
  });

  it("§21 invariant: protected display is clamped so a legacy >100% figure never appears as more-than-full", () => {
    // Realistic cause: a user bumped the amount down after already
    // protecting enough. The display should still be at required.
    const r = derivePreparationStatus({
      preparationDate: "2026-10-01",
      todayIso: today,
      requiredMinor: 10000,
      protectedMinor: 15000,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("ready");
    expect(r.protectedMinor).toBe(10000); // clamped for display
    expect(r.remainingMinor).toBe(0);
  });

  it("zero required amount is trivially ready, not preparation_due", () => {
    const r = derivePreparationStatus({
      preparationDate: "2026-10-01",
      todayIso: today,
      requiredMinor: 0,
      protectedMinor: 0,
      paymentAlreadyPaid: false,
    });
    expect(r.kind).toBe("ready");
  });

  it("daysUntilPreparation is a signed delta in days", () => {
    expect(
      derivePreparationStatus({
        preparationDate: "2026-10-10",
        todayIso: today,
        requiredMinor: 1,
        protectedMinor: 0,
        paymentAlreadyPaid: false,
      }).daysUntilPreparation,
    ).toBe(7);

    expect(
      derivePreparationStatus({
        preparationDate: "2026-09-25",
        todayIso: today,
        requiredMinor: 1,
        protectedMinor: 0,
        paymentAlreadyPaid: false,
      }).daysUntilPreparation,
    ).toBe(-8);
  });
});
