import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow } from "@spencare/domain-application";
import { AddBudgetSheet } from "./add-budget-sheet";

vi.mock("./actions", () => ({
  createBudgetAction: vi.fn(async () => ({ ok: true, value: {} })),
}));
vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

beforeEach(async () => {
  const { createBudgetAction } = await import("./actions");
  vi.mocked(createBudgetAction).mockReset();
  vi.mocked(createBudgetAction).mockResolvedValue({ ok: true, value: {} as never });
  const { toastConfirmed, toastError } = await import("@/lib/toast");
  vi.mocked(toastConfirmed).mockReset();
  vi.mocked(toastError).mockReset();
});

const categories: CategoryRow[] = [
  { id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", user_id: null, name: "Dining", icon: "utensils", is_system: true },
  { id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491", user_id: null, name: "Transport", icon: "car", is_system: true },
];

describe("<AddBudgetSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <AddBudgetSheet open onOpenChange={() => {}} onCreated={() => {}} periodStart="2026-08-01" categories={categories} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<AddBudgetSheet open onOpenChange={() => {}} onCreated={() => {}} periodStart="2026-08-01" categories={categories} />);
    expect(screen.getByRole("button", { name: "Add budget" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<AddBudgetSheet> — behavior", () => {
  it("requires a category before submitting", async () => {
    const { createBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddBudgetSheet open onOpenChange={() => {}} onCreated={() => {}} periodStart="2026-08-01" categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Add budget" }));
    expect(createBudgetAction).not.toHaveBeenCalled();
  });

  it("submits a valid budget scoped to the given period", async () => {
    const { createBudgetAction } = await import("./actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddBudgetSheet open onOpenChange={() => {}} onCreated={onCreated} periodStart="2026-08-01" categories={categories} />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.clear(screen.getByLabelText("Monthly limit (INR ₹)"));
    await user.type(screen.getByLabelText("Monthly limit (INR ₹)"), "6000");
    await user.click(screen.getByRole("button", { name: "Add budget" }));
    expect(createBudgetAction).toHaveBeenCalledWith({
      categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
      amountMinor: 600000,
      periodStart: "2026-08-01",
      applyToUpcoming: false,
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("unchecked 'Apply to all upcoming months' submits directly with no confirmation", async () => {
    const { createBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddBudgetSheet open onOpenChange={() => {}} onCreated={() => {}} periodStart="2026-08-01" categories={categories} />);
    expect(screen.getByRole("checkbox", { name: "Apply this budget to all upcoming months" })).not.toBeChecked();
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.clear(screen.getByLabelText("Monthly limit (INR ₹)"));
    await user.type(screen.getByLabelText("Monthly limit (INR ₹)"), "6000");
    await user.click(screen.getByRole("button", { name: "Add budget" }));
    expect(screen.queryByText("Apply to upcoming months?")).not.toBeInTheDocument();
    expect(createBudgetAction).toHaveBeenCalledWith(expect.objectContaining({ applyToUpcoming: false }));
  });

  it("checking 'Apply to all upcoming months' shows the confirmation dialog before creating anything", async () => {
    const { createBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddBudgetSheet open onOpenChange={() => {}} onCreated={() => {}} periodStart="2026-08-01" categories={categories} />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.clear(screen.getByLabelText("Monthly limit (INR ₹)"));
    await user.type(screen.getByLabelText("Monthly limit (INR ₹)"), "6000");
    await user.click(screen.getByRole("checkbox", { name: "Apply this budget to all upcoming months" }));
    await user.click(screen.getByRole("button", { name: "Add budget" }));

    expect(screen.getByText("Apply to upcoming months?")).toBeInTheDocument();
    expect(createBudgetAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(createBudgetAction).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874", applyToUpcoming: true }),
    );
  });

  it("defaults the month field to the dashboard's current period", () => {
    render(<AddBudgetSheet open onOpenChange={() => {}} onCreated={() => {}} periodStart="2026-08-01" categories={categories} />);
    expect(screen.getByLabelText("Month")).toHaveValue("2026-08");
  });

  it("surfaces a duplicate-budget error from the server without crashing or calling onCreated", async () => {
    const { createBudgetAction } = await import("./actions");
    const { toastError } = await import("@/lib/toast");
    vi.mocked(createBudgetAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "create_failed", message: "A budget for this category and month already exists." },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddBudgetSheet open onOpenChange={() => {}} onCreated={onCreated} periodStart="2026-08-01" categories={categories} />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.clear(screen.getByLabelText("Monthly limit (INR ₹)"));
    await user.type(screen.getByLabelText("Monthly limit (INR ₹)"), "6000");
    await user.click(screen.getByRole("button", { name: "Add budget" }));
    expect(toastError).toHaveBeenCalledWith("A budget for this category and month already exists.");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
