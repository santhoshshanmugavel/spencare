import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatePlanSheet } from "./create-plan-sheet";

vi.mock("./actions", () => ({
  createPlanAction: vi.fn(),
  updatePlanBudgetAction: vi.fn(),
}));

beforeEach(async () => {
  const { createPlanAction, updatePlanBudgetAction } = await import("./actions");
  vi.mocked(createPlanAction).mockReset();
  vi.mocked(updatePlanBudgetAction).mockReset();
  vi.mocked(createPlanAction).mockResolvedValue({
    ok: true,
    value: { id: "plan-1", name: "Thailand Trip" } as never,
  });
  vi.mocked(updatePlanBudgetAction).mockResolvedValue({ ok: true, value: {} as never });
});

describe("<CreatePlanSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<CreatePlanSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<CreatePlanSheet> — progressive creation (Gate 4 E2E flow A)", () => {
  it("requires only a name — 'Just track it' mode with no budget or dates", async () => {
    const { createPlanAction, updatePlanBudgetAction } = await import("./actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreatePlanSheet open onOpenChange={() => {}} onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Plan name"), "Thailand Trip");
    await user.click(screen.getByRole("button", { name: "Create Plan" }));

    expect(createPlanAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Thailand Trip", baseCurrency: "INR" }),
    );
    expect(updatePlanBudgetAction).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("blocks submission with no name", async () => {
    const { createPlanAction } = await import("./actions");
    const user = userEvent.setup();
    render(<CreatePlanSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Create Plan" }));
    expect(await screen.findByText("Give this Plan a name.")).toBeInTheDocument();
    expect(createPlanAction).not.toHaveBeenCalled();
  });

  it("'Total limit' mode: also sets a budget via a second call once the Plan is created", async () => {
    const { createPlanAction, updatePlanBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<CreatePlanSheet open onOpenChange={() => {}} onCreated={() => {}} />);

    await user.type(screen.getByLabelText("Plan name"), "Thailand Trip");
    await user.type(screen.getByLabelText(/Total budget/), "100000");
    await user.click(screen.getByRole("button", { name: "Create Plan" }));

    expect(createPlanAction).toHaveBeenCalledWith(expect.objectContaining({ name: "Thailand Trip" }));
    expect(updatePlanBudgetAction).toHaveBeenCalledWith("plan-1", { budgetMinor: 10000000 });
  });

  it("shows an inline error and never calls the budget action when the budget is malformed", async () => {
    const { createPlanAction, updatePlanBudgetAction } = await import("./actions");
    const user = userEvent.setup();
    render(<CreatePlanSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.type(screen.getByLabelText("Plan name"), "Thailand Trip");
    await user.type(screen.getByLabelText(/Total budget/), "not a number");
    await user.click(screen.getByRole("button", { name: "Create Plan" }));
    expect(await screen.findByText("Invalid amount.")).toBeInTheDocument();
    expect(createPlanAction).not.toHaveBeenCalled();
    expect(updatePlanBudgetAction).not.toHaveBeenCalled();
  });

  it("surfaces a server-side validation error via toast-worthy message without crashing", async () => {
    const { createPlanAction } = await import("./actions");
    vi.mocked(createPlanAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "validation_error", message: "Give this Plan a name." },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreatePlanSheet open onOpenChange={() => {}} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Plan name"), "x");
    await user.click(screen.getByRole("button", { name: "Create Plan" }));
    expect(createPlanAction).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
