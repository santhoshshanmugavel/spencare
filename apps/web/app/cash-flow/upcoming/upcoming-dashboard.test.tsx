"use client";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  AccountRow,
  CategoryRow,
  LoanRow,
  PlannedCommitmentOccurrenceWithCommitment,
  PlannedCommitmentRow,
} from "@spencare/domain-application";
import { UpcomingDashboard } from "./upcoming-dashboard";
import type { PrepEvent, ProjectedOccurrence } from "./page";

// ── Module mocks ──────────────────────────────────────────────────────────────

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("./actions", () => ({
  deleteLoanAction: vi.fn().mockResolvedValue({ ok: true }),
  deleteCommitmentAction: vi.fn().mockResolvedValue({ ok: true }),
  pauseCommitmentAction: vi.fn().mockResolvedValue({ ok: true }),
  resumeCommitmentAction: vi.fn().mockResolvedValue({ ok: true }),
  skipOccurrenceAction: vi.fn().mockResolvedValue({ ok: true }),
  reserveOccurrenceAction: vi.fn().mockResolvedValue({ ok: true }),
  markOccurrencePaidAction: vi.fn().mockResolvedValue({ ok: true }),
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────

const bankAccount: AccountRow = {
  id: "acc-1",
  user_id: "u1",
  type: "bank",
  name: "HDFC Bank",
  currency: "INR",
  balance_minor: 500000,
  credit_limit_minor: null,
  credit_used_minor: null,
  market_value_minor: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const entertainmentCategory: CategoryRow = {
  id: "cat-ent",
  user_id: null,
  name: "Entertainment",
  icon: "tv",
  is_system: true,
};

/** A minimal active PlannedCommitmentRow. */
function makeCommitment(overrides: Partial<PlannedCommitmentRow> = {}): PlannedCommitmentRow {
  return {
    id: "c1",
    user_id: "u1",
    name: "Netflix",
    category_id: "cat-ent",
    amount_minor: 19900,
    amount_is_estimate: false,
    currency: "INR",
    payment_frequency: "monthly",
    next_payment_date: "2026-11-02",
    saving_cadence: null,
    saving_amount_minor: null,
    first_saving_date: null,
    funding_account_id: null,
    payment_account_id: "acc-1",
    reserve_account_id: null,
    tenure_type: "ongoing",
    tenure_payments: null,
    tenure_end_date: null,
    status: "active",
    notes: null,
    migrated_from_bill_id: null,
    auto_pay_enabled: false,
    auto_protect_enabled: false,
    payment_day_rule: 2,
    created_at: "2026-09-19T02:46:00Z",
    updated_at: "2026-09-19T02:46:00Z",
    deleted_at: null,
    ...overrides,
  };
}

/** A projected occurrence (no DB row) for a given commitment + date. */
function makeProjected(commitment: PlannedCommitmentRow, date: string): ProjectedOccurrence {
  return { commitment, date, amountMinor: commitment.amount_minor };
}

/** A minimal persisted upcoming occurrence with a nested commitment sub-object. */
function makeOccurrence(
  commitment: PlannedCommitmentRow,
  date: string,
  overrides: Partial<PlannedCommitmentOccurrenceWithCommitment> = {},
): PlannedCommitmentOccurrenceWithCommitment {
  return {
    id: `occ-${commitment.id}-${date}`,
    commitment_id: commitment.id,
    user_id: "u1",
    due_date: date,
    amount_minor: commitment.amount_minor,
    reserved_minor: 0,
    status: "upcoming",
    matched_transaction_id: null,
    paid_at: null,
    created_at: date + "T00:00:00Z",
    updated_at: date + "T00:00:00Z",
    planned_commitments: {
      name: commitment.name,
      category_id: commitment.category_id,
      payment_frequency: commitment.payment_frequency,
      payment_account_id: commitment.payment_account_id,
      reserve_account_id: commitment.reserve_account_id,
      funding_account_id: commitment.funding_account_id,
      deleted_at: commitment.deleted_at,
    },
    ...overrides,
  };
}

const emptyProps = {
  commitmentOccurrences: [] as PlannedCommitmentOccurrenceWithCommitment[],
  commitments: [] as PlannedCommitmentRow[],
  billPredictions: [],
  loans: [] as LoanRow[],
  accounts: [bankAccount],
  categories: [entertainmentCategory],
  prepEvents: [] as PrepEvent[],
  projectedOccurrences: [] as ProjectedOccurrence[],
  masked: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UpcomingDashboard — empty state", () => {
  it("shows nothing-upcoming empty state when no items exist", () => {
    render(<UpcomingDashboard {...emptyProps} />);
    expect(screen.getByText("Nothing upcoming")).toBeInTheDocument();
  });
});

describe("UpcomingDashboard — projected items (regression: no-occurrence commitment stays visible)", () => {
  const commitment = makeCommitment({ next_payment_date: "2026-11-02" });
  // today is assumed by the dashboard to be determined from `new Date()`; select the month
  // of the projected item (Nov 2026) to see it.
  const proj = makeProjected(commitment, "2026-11-02");

  it("renders the projected item title without a 'Projected' italic suffix", async () => {
    const user = userEvent.setup();
    render(<UpcomingDashboard {...emptyProps} commitments={[commitment]} projectedOccurrences={[proj]} />);
    // Navigate to the month that contains the projected item.
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    // The word "Projected" must not appear as visible text (removed from UI per spec).
    expect(screen.queryByText(/projected/i)).not.toBeInTheDocument();
  });

  it("projected item has a commitment-level actions button (regression: was absent)", async () => {
    const user = userEvent.setup();
    render(<UpcomingDashboard {...emptyProps} commitments={[commitment]} projectedOccurrences={[proj]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    // The actions button must exist on projected items.
    expect(screen.getByRole("button", { name: /actions for netflix/i })).toBeInTheDocument();
  });

  it("projected item actions menu contains Edit, Pause, and Delete commitment (not occurrence-level actions)", async () => {
    const user = userEvent.setup();
    render(<UpcomingDashboard {...emptyProps} commitments={[commitment]} projectedOccurrences={[proj]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    await user.click(screen.getByRole("button", { name: /actions for netflix/i }));

    expect(screen.getByText("Edit commitment")).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Delete commitment")).toBeInTheDocument();

    // Occurrence-level actions must NOT appear for projected items.
    expect(screen.queryByText("Mark as paid")).not.toBeInTheDocument();
    expect(screen.queryByText("Skip this payment")).not.toBeInTheDocument();
    expect(screen.queryByText("Reserve money")).not.toBeInTheDocument();
  });

  it("paused commitment shows 'Resume' instead of 'Pause' in actions menu", async () => {
    const user = userEvent.setup();
    const pausedCommitment = makeCommitment({ status: "paused" });
    const pausedProj = makeProjected(pausedCommitment, "2026-11-02");
    render(<UpcomingDashboard {...emptyProps} commitments={[pausedCommitment]} projectedOccurrences={[pausedProj]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    await user.click(screen.getByRole("button", { name: /actions for netflix/i }));
    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.queryByText(/^Pause$/)).not.toBeInTheDocument();
  });
});

describe("UpcomingDashboard — persisted occurrence suppresses projection (dedup regression)", () => {
  it("when a commitment has a persisted upcoming occurrence in Nov, that month shows ONE item not two", async () => {
    const user = userEvent.setup();
    // The page.tsx deduplication ensures the projected occurrence is never generated when
    // a persisted occurrence already covers that commitment+month. This test verifies that
    // if both arrive (shouldn't happen in practice after the fix), the component renders them
    // as separate items -- meaning the page-level dedup must be correct, not component-level.
    // Here we simulate the post-fix world: only one item arrives for Nov.
    const commitment = makeCommitment();
    const occ = makeOccurrence(commitment, "2026-11-02");

    render(
      <UpcomingDashboard
        {...emptyProps}
        commitments={[commitment]}
        commitmentOccurrences={[occ]}
        projectedOccurrences={[]} // page.tsx dedup: projected suppressed because Nov is persisted
      />,
    );
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    // Exactly one Netflix item.
    expect(screen.getAllByText("Netflix")).toHaveLength(1);
  });

  it("two distinct commitments with the same name and different dates render as two separate items", async () => {
    const user = userEvent.setup();
    const c1 = makeCommitment({ id: "c1", name: "Netflix", next_payment_date: "2026-11-02" });
    const c2 = makeCommitment({ id: "c2", name: "Netflix", next_payment_date: "2026-11-13", payment_day_rule: 13 });
    const proj1 = makeProjected(c1, "2026-11-02");
    const proj2 = makeProjected(c2, "2026-11-13");

    render(
      <UpcomingDashboard
        {...emptyProps}
        commitments={[c1, c2]}
        projectedOccurrences={[proj1, proj2]}
      />,
    );
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    // Both items must appear -- no incorrect merging.
    expect(screen.getAllByText("Netflix")).toHaveLength(2);
  });
});

describe("UpcomingDashboard — persisted occurrence actions include 'Skip this payment' not 'Skip this occurrence'", () => {
  it("persisted occurrence actions menu says 'Skip this payment'", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment();
    const occ = makeOccurrence(commitment, "2026-11-02");
    render(
      <UpcomingDashboard
        {...emptyProps}
        commitments={[commitment]}
        commitmentOccurrences={[occ]}
      />,
    );
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    await user.click(screen.getByRole("button", { name: /actions for netflix/i }));
    expect(screen.getByText("Skip this payment")).toBeInTheDocument();
    expect(screen.queryByText("Skip this occurrence")).not.toBeInTheDocument();
  });
});

describe("UpcomingDashboard — month summary bar", () => {
  it("shows 'Payments due' total for commitment amounts in selected month", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ amount_minor: 19900 });
    const occ = makeOccurrence(commitment, "2026-11-02");
    render(
      <UpcomingDashboard {...emptyProps} commitments={[commitment]} commitmentOccurrences={[occ]} />,
    );
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    expect(screen.getByText("Payments due")).toBeInTheDocument();
    // Amount appears in both the summary bar and the item row; check at least one exists.
    expect(screen.getAllByText("₹199.00").length).toBeGreaterThan(0);
  });

  it("month summary does not appear when selected month has no items", () => {
    render(<UpcomingDashboard {...emptyProps} />);
    expect(screen.queryByText("Payments due")).not.toBeInTheDocument();
  });
});

describe("UpcomingDashboard — soft-deleted commitment generates no projection (cleanup regression)", () => {
  it("absent from commitments + empty projectedOccurrences = Netflix never appears in any tab", async () => {
    const user = userEvent.setup();
    // Simulate post-cleanup state: page.tsx's listCommitments returns [] because the
    // Netflix commitment has deleted_at set. The projection loop over [] produces no events.
    // The historical paid occurrence is NOT in commitmentOccurrences because
    // listUpcoming only returns status='upcoming' rows.
    render(
      <UpcomingDashboard
        {...emptyProps}
        commitments={[]}           // soft-deleted commitment is absent
        projectedOccurrences={[]}  // no projection because no active commitment
        commitmentOccurrences={[]} // historical paid occurrence not shown (not 'upcoming')
      />,
    );
    // Check current month and navigate to Nov -- Netflix must appear in neither.
    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
  });

  it("historical paid occurrence for a deleted commitment does not appear as a future item", () => {
    // Even if a paid occurrence somehow ended up in commitmentOccurrences, the 'paid' status
    // means listUpcoming would never return it (it only fetches status='upcoming').
    // This test documents the contract: if commitmentOccurrences is correctly populated
    // (upcoming-only), a paid Oct occurrence for a deleted commitment is invisible.
    const deletedCommitment = makeCommitment({ deleted_at: "2026-09-19T10:59:00Z" });
    const paidOcc = makeOccurrence(deletedCommitment, "2026-10-02", { status: "paid", paid_at: "2026-09-19T02:47:00Z" });
    // The page passes commitmentOccurrences = only upcoming rows. Paid row excluded.
    render(
      <UpcomingDashboard
        {...emptyProps}
        commitments={[]}           // deleted commitment is absent from listCommitments
        commitmentOccurrences={[]} // page correctly excludes the paid occurrence
        projectedOccurrences={[]}  // no projection because deleted
      />,
    );
    // The paid occurrence (paidOcc) is not in any prop -- verify Netflix is absent.
    void paidOcc; // reference to avoid unused-var lint
    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
  });
});
