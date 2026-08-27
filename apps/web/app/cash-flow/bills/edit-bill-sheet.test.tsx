import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BillDefinitionRow, CategoryRow } from "@spencare/domain-application";
import { EditBillSheet } from "./edit-bill-sheet";

vi.mock("./actions", () => ({
  updateBillAction: vi.fn(async () => ({ ok: true, value: {} })),
}));
vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

beforeEach(async () => {
  const { updateBillAction } = await import("./actions");
  vi.mocked(updateBillAction).mockReset();
  vi.mocked(updateBillAction).mockResolvedValue({ ok: true, value: {} as never });
});

const categories: CategoryRow[] = [
  { id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", user_id: null, name: "Bills & Utilities", icon: "receipt", is_system: true },
];

const bill: BillDefinitionRow = {
  id: "bill-1",
  user_id: "user-a",
  merchant_pattern: "Netflix",
  category_id: null,
  expected_amount_minor: 49900,
  expected_amount_tolerance_pct: null,
  recurrence_interval: "monthly",
  detection_source: "manual",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

describe("<EditBillSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<EditBillSheet bill={bill} categories={categories} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<EditBillSheet> — behavior", () => {
  it("pre-fills the current name and amount", () => {
    render(<EditBillSheet bill={bill} categories={categories} open onOpenChange={() => {}} onUpdated={() => {}} />);
    expect(screen.getByLabelText("Bill name")).toHaveValue("Netflix");
    expect(screen.getByLabelText(/Expected amount/i)).toHaveValue("499");
  });

  it("submits the updated name", async () => {
    const { updateBillAction } = await import("./actions");
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditBillSheet bill={bill} categories={categories} open onOpenChange={() => {}} onUpdated={onUpdated} />);
    const nameInput = screen.getByLabelText("Bill name");
    await user.clear(nameInput);
    await user.type(nameInput, "Netflix Premium");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateBillAction).toHaveBeenCalledWith("bill-1", expect.objectContaining({ merchantPattern: "Netflix Premium" }));
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("allows clearing the amount to make the bill variable", async () => {
    const { updateBillAction } = await import("./actions");
    const user = userEvent.setup();
    render(<EditBillSheet bill={bill} categories={categories} open onOpenChange={() => {}} onUpdated={() => {}} />);
    const amountInput = screen.getByLabelText(/Expected amount/i);
    await user.clear(amountInput);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateBillAction).toHaveBeenCalledWith("bill-1", expect.objectContaining({ expectedAmountMinor: null }));
  });
});
