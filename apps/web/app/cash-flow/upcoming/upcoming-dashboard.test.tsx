"use client";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountRow,
  CategoryRow,
  LoanRow,
  PlannedCommitmentRow,
  UpcomingEvent,
} from "@spencare/domain-application";
import { UpcomingDashboard } from "./upcoming-dashboard";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toastConfirmed: vi.fn(), toastError: vi.fn() }));
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
  statement_close_day: null,
  payment_due_day: null,
};

const entertainmentCategory: CategoryRow = {
  id: "cat-ent",
  user_id: null,
  name: "Entertainment",
  icon: "tv",
  is_system: true,
};

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
    tenure_type: "none",
    tenure_payments: null,
    tenure_end_date: null,
    status: "active",
    notes: null,
    migrated_from_bill_id: null,
    auto_pay_enabled: false,
    auto_protect_enabled: false,
    payment_day_rule: 2,
    saving_day_rule: null,
    created_at: "2026-09-19T02:46:00Z",
    updated_at: "2026-09-19T02:46:00Z",
    deleted_at: null,
    ...overrides,
  };
}

/** A projected commitment_payment event (no persisted occurrence yet). */
function makeProjectedPaymentEvent(commitment: PlannedCommitmentRow, date: string): UpcomingEvent {
  return {
    id: `proj:commitment_payment:${commitment.id}:${date}`,
    kind: "commitment_payment",
    date,
    title: commitment.name,
    subtitle: null,
    amountMinor: commitment.amount_minor,
    currency: "INR",
    sourceId: commitment.id,
    projected: true,
    paymentAccountId: commitment.payment_account_id,
    reserveAccountId: commitment.reserve_account_id,
    categoryId: commitment.category_id,
    paymentFrequency: commitment.payment_frequency,
    paymentDayRule: commitment.payment_day_rule,
    autoPayEnabled: commitment.auto_pay_enabled ?? false,
    autoProtectEnabled: commitment.auto_protect_enabled ?? false,
    tenureType: commitment.tenure_type,
    tenurePayments: commitment.tenure_payments,
    tenureEndDate: commitment.tenure_end_date,
  };
}

/** A persisted commitment_payment event (has occurrenceId). */
function makePersistedPaymentEvent(commitment: PlannedCommitmentRow, date: string, occurrenceId = `occ-${commitment.id}-${date}`): UpcomingEvent {
  return {
    ...makeProjectedPaymentEvent(commitment, date),
    id: occurrenceId,
    projected: false,
    occurrenceId,
    reservedMinor: 0,
    occurrenceStatus: "upcoming",
  };
}

const emptyProps = {
  events: [] as UpcomingEvent[],
  commitments: [] as PlannedCommitmentRow[],
  loans: [] as LoanRow[],
  accounts: [bankAccount],
  categories: [entertainmentCategory],
  masked: false,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UpcomingDashboard -- empty state", () => {
  it("shows nothing-upcoming empty state when no events exist", () => {
    render(<UpcomingDashboard {...emptyProps} />);
    expect(screen.getByText("Nothing upcoming")).toBeInTheDocument();
  });
});

describe("UpcomingDashboard -- projected items", () => {
  it("renders projected item title", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ next_payment_date: "2026-11-02" });
    const ev = makeProjectedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });

  it("projected item has a commitment-level actions button", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ next_payment_date: "2026-11-02" });
    const ev = makeProjectedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    expect(screen.getByRole("button", { name: /actions for netflix/i })).toBeInTheDocument();
  });

  it("projected item actions menu has Edit, Pause, Delete -- not occurrence-level actions", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ next_payment_date: "2026-11-02" });
    const ev = makeProjectedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    await user.click(screen.getByRole("button", { name: /actions for netflix/i }));

    expect(screen.getByText("Edit commitment")).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Delete commitment")).toBeInTheDocument();

    expect(screen.queryByText("Mark as paid")).not.toBeInTheDocument();
    expect(screen.queryByText("Skip this payment")).not.toBeInTheDocument();
    expect(screen.queryByText("Reserve money")).not.toBeInTheDocument();
  });

  it("paused commitment shows 'Resume' instead of 'Pause' in actions menu", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ status: "paused" });
    const ev = makeProjectedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    await user.click(screen.getByRole("button", { name: /actions for netflix/i }));

    expect(screen.getByText("Resume")).toBeInTheDocument();
    expect(screen.queryByText(/^Pause$/)).not.toBeInTheDocument();
  });
});

describe("UpcomingDashboard -- persisted occurrence actions", () => {
  it("persisted occurrence actions menu says 'Skip this payment'", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment();
    const ev = makePersistedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    await user.click(screen.getByRole("button", { name: /actions for netflix/i }));

    expect(screen.getByText("Skip this payment")).toBeInTheDocument();
    expect(screen.queryByText("Skip this occurrence")).not.toBeInTheDocument();
  });
});

describe("UpcomingDashboard -- deduplication (two events, two items)", () => {
  it("two distinct commitments with same name render as two separate items", async () => {
    const user = userEvent.setup();
    const c1 = makeCommitment({ id: "c1", name: "Netflix", next_payment_date: "2026-11-02", payment_day_rule: 2 });
    const c2 = makeCommitment({ id: "c2", name: "Netflix", next_payment_date: "2026-11-13", payment_day_rule: 13 });
    const ev1 = makeProjectedPaymentEvent(c1, "2026-11-02");
    const ev2 = { ...makeProjectedPaymentEvent(c2, "2026-11-13"), id: "proj:c2:2026-11-13" };

    render(<UpcomingDashboard {...emptyProps} events={[ev1, ev2]} commitments={[c1, c2]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    expect(screen.getAllByText("Netflix")).toHaveLength(2);
  });
});

describe("UpcomingDashboard -- month summary bar", () => {
  it("shows 'Payments due' total for commitment amounts in selected month", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ amount_minor: 19900 });
    const ev = makePersistedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    expect(screen.getByText("Payments due")).toBeInTheDocument();
    expect(screen.getAllByText("₹199.00").length).toBeGreaterThan(0);
  });

  it("month summary does not appear when selected month has no items", () => {
    render(<UpcomingDashboard {...emptyProps} />);
    expect(screen.queryByText("Payments due")).not.toBeInTheDocument();
  });
});

describe("UpcomingDashboard -- soft-deleted commitment generates no projection", () => {
  it("empty commitments and events = Netflix never appears in any tab", async () => {
    const user = userEvent.setup();
    render(<UpcomingDashboard {...emptyProps} />);
    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);
    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
  });
});

// ── Date grouping tests ───────────────────────────────────────────────────────

describe("UpcomingDashboard -- date grouping", () => {
  it("shows a date heading for an event (day + full month name)", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ next_payment_date: "2026-11-02" });
    const ev = makeProjectedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    // Heading contains "2 November" (day + full month; weekday may vary by locale)
    expect(screen.getByText(/2 November/)).toBeInTheDocument();
  });

  it("two events on same date share exactly one date heading", async () => {
    const user = userEvent.setup();
    const c1 = makeCommitment({ id: "c1", name: "Netflix", next_payment_date: "2026-11-02", payment_day_rule: 2 });
    const c2 = makeCommitment({ id: "c2", name: "Spotify", next_payment_date: "2026-11-02", payment_day_rule: 2 });
    const ev1 = makeProjectedPaymentEvent(c1, "2026-11-02");
    const ev2 = makeProjectedPaymentEvent(c2, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev1, ev2]} commitments={[c1, c2]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("Spotify")).toBeInTheDocument();
    // Only one date heading despite two events
    expect(screen.getAllByText(/2 November/)).toHaveLength(1);
  });

  it("events on different dates get separate date headings", async () => {
    const user = userEvent.setup();
    const c1 = makeCommitment({ id: "c1", name: "Netflix", next_payment_date: "2026-11-02", payment_day_rule: 2 });
    const c2 = makeCommitment({ id: "c2", name: "Spotify", next_payment_date: "2026-11-13", payment_day_rule: 13 });
    const ev1 = makeProjectedPaymentEvent(c1, "2026-11-02");
    const ev2 = makeProjectedPaymentEvent(c2, "2026-11-13");

    render(<UpcomingDashboard {...emptyProps} events={[ev1, ev2]} commitments={[c1, c2]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    expect(screen.getByText(/2 November/)).toBeInTheDocument();
    expect(screen.getByText(/13 November/)).toBeInTheDocument();
  });

  it("date headings appear in chronological order regardless of event input order", async () => {
    const user = userEvent.setup();
    // c1 has the later date; c2 has the earlier date -- verify display order is still ascending
    const c1 = makeCommitment({ id: "c1", name: "Netflix", next_payment_date: "2026-11-13", payment_day_rule: 13 });
    const c2 = makeCommitment({ id: "c2", name: "Spotify", next_payment_date: "2026-11-02", payment_day_rule: 2 });
    const ev1 = makeProjectedPaymentEvent(c1, "2026-11-13");
    const ev2 = makeProjectedPaymentEvent(c2, "2026-11-02");

    // Pass events with later date first to verify the component sorts them
    render(<UpcomingDashboard {...emptyProps} events={[ev1, ev2]} commitments={[c1, c2]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    const headings = screen.getAllByText(/November/);
    expect(headings).toHaveLength(2);
    // Nov 2 heading must come before Nov 13 in the DOM
    expect(headings[0]?.textContent).toMatch(/2 November/);
    expect(headings[1]?.textContent).toMatch(/13 November/);
  });

  it("selected month with no events shows nothing-due message", async () => {
    const user = userEvent.setup();
    // Event in Nov; selecting Oct should show nothing-due message
    const commitment = makeCommitment({ next_payment_date: "2026-11-02" });
    const ev = makeProjectedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const octTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Oct"));
    if (octTab) await user.click(octTab);

    expect(screen.getByText(/Nothing due in/)).toBeInTheDocument();
  });

  it("commitment_preparation and commitment_payment on same date share one date heading", async () => {
    const user = userEvent.setup();
    const commitment = makeCommitment({ id: "c1", name: "Insurance", next_payment_date: "2026-11-02", payment_day_rule: 2 });
    const paymentEv = makeProjectedPaymentEvent(commitment, "2026-11-02");
    const prepEv: UpcomingEvent = {
      id: "proj:commitment_preparation:c1:2026-11-02",
      kind: "commitment_preparation",
      date: "2026-11-02",
      title: "Prepare for Insurance",
      subtitle: "Insurance",
      amountMinor: 5000,
      currency: "INR",
      sourceId: "c1",
      projected: true,
      preparationForDate: "2026-12-02",
      preparationForOccurrenceId: undefined,
      savingCadence: "monthly",
      savingAmountMinor: 5000,
      autoProtectEnabled: false,
      reserveAccountId: null,
    };

    render(<UpcomingDashboard {...emptyProps} events={[prepEv, paymentEv]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    expect(screen.getByText("Insurance")).toBeInTheDocument();
    expect(screen.getByText("Prepare for Insurance")).toBeInTheDocument();
    // Only one date heading for Nov 2
    expect(screen.getAllByText(/2 November/)).toHaveLength(1);
  });

  it("date heading uses local calendar date (parses ev.date as local YYYY-MM-DD)", async () => {
    // ev.date "2026-11-02" is a local date string; heading must show "2 November" not a UTC-shifted date
    const user = userEvent.setup();
    const commitment = makeCommitment({ next_payment_date: "2026-11-02" });
    const ev = makeProjectedPaymentEvent(commitment, "2026-11-02");

    render(<UpcomingDashboard {...emptyProps} events={[ev]} commitments={[commitment]} />);
    const novTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("Nov"));
    if (novTab) await user.click(novTab);

    expect(screen.getByText(/2 November/)).toBeInTheDocument();
    expect(screen.queryByText(/1 November/)).not.toBeInTheDocument();
    expect(screen.queryByText(/3 November/)).not.toBeInTheDocument();
  });
});
