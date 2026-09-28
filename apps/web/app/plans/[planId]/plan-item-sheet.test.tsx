import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow, PlanItemRow } from "@spencare/domain-application";
import { PlanItemSheet } from "./plan-item-sheet";

vi.mock("../actions", () => ({
  addPlanItemAction: vi.fn(async () => ({ ok: true, value: {} })),
  updatePlanItemAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { addPlanItemAction, updatePlanItemAction } = await import("../actions");
  vi.mocked(addPlanItemAction).mockReset();
  vi.mocked(updatePlanItemAction).mockReset();
  vi.mocked(addPlanItemAction).mockResolvedValue({ ok: true, value: {} as never });
  vi.mocked(updatePlanItemAction).mockResolvedValue({ ok: true, value: {} as never });
});

const categories: CategoryRow[] = [
  { id: "6aedc5e6-3884-4a33-84dd-22672d745744", user_id: null, name: "Flights", icon: null, is_system: true },
  { id: "08117b0f-abff-4e87-916b-780b1dc67905", user_id: null, name: "Food", icon: null, is_system: true },
];

const PLAN_ID = "plan-1";

describe("<PlanItemSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <PlanItemSheet planId={PLAN_ID} currency="INR" categories={categories} item={null} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<PlanItemSheet> — add mode", () => {
  it("adds a bare placeholder item with no estimate yet (progressive planning)", async () => {
    const { addPlanItemAction } = await import("../actions");
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <PlanItemSheet planId={PLAN_ID} currency="INR" categories={categories} item={null} open onOpenChange={() => {}} onSaved={onSaved} />,
    );
    await user.type(screen.getByLabelText("Item name"), "Flights");
    await user.click(screen.getByRole("button", { name: "Add item" }));
    expect(addPlanItemAction).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({ name: "Flights", estimatedAmountMinor: null, estimatedCurrency: null }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("adds an item with a priced estimate in the Plan's currency", async () => {
    const { addPlanItemAction } = await import("../actions");
    const user = userEvent.setup();
    render(
      <PlanItemSheet planId={PLAN_ID} currency="INR" categories={categories} item={null} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    await user.type(screen.getByLabelText("Item name"), "Flights");
    await user.type(screen.getByLabelText(/Estimated amount/), "18000");
    await user.click(screen.getByRole("button", { name: "Add item" }));
    expect(addPlanItemAction).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({ estimatedAmountMinor: 1800000, estimatedCurrency: "INR" }),
    );
  });

  it("requires a name", async () => {
    const { addPlanItemAction } = await import("../actions");
    const user = userEvent.setup();
    render(
      <PlanItemSheet planId={PLAN_ID} currency="INR" categories={categories} item={null} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByText("Give this item a name.")).toBeInTheDocument();
    expect(addPlanItemAction).not.toHaveBeenCalled();
  });
});

describe("<PlanItemSheet> — edit mode", () => {
  const item: PlanItemRow = {
    id: "item-1",
    plan_id: PLAN_ID,
    user_id: "u1",
    name: "Flights",
    description: null,
    category_id: "6aedc5e6-3884-4a33-84dd-22672d745744",
    estimated_amount_minor: 1800000,
    estimated_currency: "INR",
    status: "planned",
    expected_date: null,
    commitment_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("pre-fills the existing item's fields", () => {
    render(
      <PlanItemSheet planId={PLAN_ID} currency="INR" categories={categories} item={item} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    expect(screen.getByLabelText("Item name")).toHaveValue("Flights");
    expect(screen.getByLabelText(/Estimated amount/)).toHaveValue("18000");
  });

  it("saves changes scoped to this item's id", async () => {
    const { updatePlanItemAction } = await import("../actions");
    const user = userEvent.setup();
    render(
      <PlanItemSheet planId={PLAN_ID} currency="INR" categories={categories} item={item} open onOpenChange={() => {}} onSaved={() => {}} />,
    );
    const nameInput = screen.getByLabelText("Item name");
    await user.clear(nameInput);
    await user.type(nameInput, "Round-trip flights");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updatePlanItemAction).toHaveBeenCalledWith(
      PLAN_ID,
      "item-1",
      expect.objectContaining({ name: "Round-trip flights" }),
    );
  });
});
