import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, BillPredictionWithDefinition, CategoryRow } from "@spencare/domain-application";
import { BillNowSheet } from "./bill-now-sheet";

vi.mock("./actions", () => ({
  markPaidAction: vi.fn(async () => ({ ok: true, value: {} })),
  undoPaidAction: vi.fn(async () => ({ ok: true, value: undefined })),
}));
vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

beforeEach(async () => {
  const { markPaidAction, undoPaidAction } = await import("./actions");
  vi.mocked(markPaidAction).mockReset();
  vi.mocked(markPaidAction).mockResolvedValue({ ok: true, value: {} as never });
  vi.mocked(undoPaidAction).mockReset();
  vi.mocked(undoPaidAction).mockResolvedValue({ ok: true, value: undefined });
  const { toastConfirmed, toastError } = await import("@/lib/toast");
  vi.mocked(toastConfirmed).mockReset();
  vi.mocked(toastError).mockReset();
});

const accounts: AccountRow[] = [
  {
    id: "5b1a9e0a-6b3f-4a2e-9c1d-2f8e4a7b3c1d",
    user_id: "user-a",
    type: "bank",
    name: "HDFC Bank",
    currency: "INR",
    balance_minor: 1000000,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "cc-1",
    user_id: "user-a",
    type: "credit_card",
    name: "Amex",
    currency: "INR",
    balance_minor: 0,
    credit_limit_minor: 500000,
    credit_used_minor: 0,
    market_value_minor: null,
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const categories: CategoryRow[] = [
  { id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", user_id: null, name: "Bills & Utilities", icon: "receipt", is_system: true },
];

function prediction(overrides: Partial<BillPredictionWithDefinition> = {}): BillPredictionWithDefinition {
  return {
    id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
    bill_definition_id: "bill-1",
    user_id: "user-a",
    expected_date: "2026-09-15",
    expected_amount_minor: 49900,
    status: "open",
    matched_transaction_id: null,
    matched_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly", deleted_at: null },
    matched_transaction: null,
    ...overrides,
  };
}

describe("<BillNowSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <BillNowSheet prediction={prediction()} accounts={accounts} categories={categories} open onOpenChange={() => {}} onPaid={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<BillNowSheet> — behavior", () => {
  it("pre-fills the amount from the prediction's expected amount, and it stays editable", async () => {
    const user = userEvent.setup();
    render(
      <BillNowSheet prediction={prediction()} accounts={accounts} categories={categories} open onOpenChange={() => {}} onPaid={() => {}} />,
    );
    const amountInput = screen.getByLabelText(/Amount paid/i);
    expect(amountInput).toHaveValue("499");
    await user.clear(amountInput);
    await user.type(amountInput, "520");
    expect(amountInput).toHaveValue("520");
  });

  it("only offers bank/cash accounts, never credit card or investment", async () => {
    const user = userEvent.setup();
    render(
      <BillNowSheet prediction={prediction()} accounts={accounts} categories={categories} open onOpenChange={() => {}} onPaid={() => {}} />,
    );
    await user.click(screen.getByRole("combobox", { name: "Paid from" }));
    expect(screen.getByRole("option", { name: "HDFC Bank · Bank" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Amex" })).not.toBeInTheDocument();
  });

  it("submits the REAL entered amount, not silently the prediction's expected amount, when the user changes it", async () => {
    const { markPaidAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <BillNowSheet prediction={prediction()} accounts={accounts} categories={categories} open onOpenChange={() => {}} onPaid={() => {}} />,
    );
    const amountInput = screen.getByLabelText(/Amount paid/i);
    await user.clear(amountInput);
    await user.type(amountInput, "520");
    await user.click(screen.getByRole("combobox", { name: "Paid from" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Bills & Utilities" }));
    await user.click(screen.getByRole("button", { name: "Confirm payment" }));
    expect(markPaidAction).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491", amountMinor: 52000 }),
    );
  });

  it("starts blank (no fabricated default) for a variable bill with a null expected amount", () => {
    render(
      <BillNowSheet
        prediction={prediction({ expected_amount_minor: null })}
        accounts={accounts}
        categories={categories}
        open
        onOpenChange={() => {}}
        onPaid={() => {}}
      />,
    );
    expect(screen.getByLabelText(/Amount paid/i)).toHaveValue("");
  });

  it("requires an account before submitting", async () => {
    const { markPaidAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <BillNowSheet prediction={prediction()} accounts={accounts} categories={categories} open onOpenChange={() => {}} onPaid={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm payment" }));
    expect(markPaidAction).not.toHaveBeenCalled();
  });

  it("surfaces a server error (e.g. already settled) without crashing or calling onPaid", async () => {
    const { markPaidAction } = await import("./actions");
    const { toastError } = await import("@/lib/toast");
    vi.mocked(markPaidAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "mark_paid_failed", message: "This bill has already been settled." },
    });
    const onPaid = vi.fn();
    const user = userEvent.setup();
    render(
      <BillNowSheet prediction={prediction()} accounts={accounts} categories={categories} open onOpenChange={() => {}} onPaid={onPaid} />,
    );
    await user.click(screen.getByRole("combobox", { name: "Paid from" }));
    await user.click(screen.getByRole("option", { name: "HDFC Bank · Bank" }));
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Bills & Utilities" }));
    await user.click(screen.getByRole("button", { name: "Confirm payment" }));
    expect(toastError).toHaveBeenCalledWith("This bill has already been settled.");
    expect(onPaid).not.toHaveBeenCalled();
  });
});
