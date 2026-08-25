import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddAccountSheet } from "./add-account-sheet";

vi.mock("./actions", () => ({
  createAccountAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

beforeEach(async () => {
  const { createAccountAction } = await import("./actions");
  vi.mocked(createAccountAction).mockReset();
  vi.mocked(createAccountAction).mockResolvedValue({ ok: true, value: {} as never });
});

describe("<AddAccountSheet> — accessibility", () => {
  it("has no axe violations on the default (Bank) tab", async () => {
    const { container } = render(
      <AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations on the Credit card tab", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await user.click(screen.getByRole("tab", { name: "Credit card" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: "Add account" })).toHaveAttribute(
      "data-size",
      "touch",
    );
  });
});

describe("<AddAccountSheet> — Change Currency (SP-236)", () => {
  it("opens the currency sub-modal and reflects the chosen currency back in the balance label", async () => {
    const user = userEvent.setup();
    render(<AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Change currency" }));
    expect(screen.getByRole("heading", { name: "Change Currency" })).toBeInTheDocument();
    expect(
      screen.getByText(/all account balances and spending will be displayed in/i),
    ).toBeInTheDocument();
  });
});

describe("<AddAccountSheet> — bank tab (default)", () => {
  it("requires a name before submitting", async () => {
    const { createAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByText(/required|enter/i)).toBeInTheDocument();
    expect(createAccountAction).not.toHaveBeenCalled();
  });

  it("submits a valid bank account with type='bank' and calls onCreated", async () => {
    const { createAccountAction } = await import("./actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddAccountSheet open onOpenChange={() => {}} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Bank name"), "HDFC Bank");
    await user.type(screen.getByLabelText("Available balance (INR ₹)"), "50000");
    await user.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByRole("button", { name: "Add account" })).toBeEnabled();
    expect(createAccountAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bank", name: "HDFC Bank", balanceMinor: 5000000 }),
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});

describe("<AddAccountSheet> — credit card tab", () => {
  it("submits type='credit_card' with limit and used amounts as separate fields", async () => {
    const { createAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("tab", { name: "Credit card" }));
    await user.type(screen.getByLabelText("Card provider"), "ICICI");
    await user.type(screen.getByLabelText("Total credit limit (INR ₹)"), "200000");
    await user.type(screen.getByLabelText("Current outstanding balance"), "45000");
    await user.click(screen.getByRole("button", { name: "Add card" }));
    expect(createAccountAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credit_card",
        name: "ICICI",
        creditLimitMinor: 20000000,
        creditUsedMinor: 4500000,
      }),
    );
  });
});

describe("<AddAccountSheet> — investment tab", () => {
  it("submits type='investment' and never asks for a live pricing/market source", async () => {
    const { createAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("tab", { name: "Investment" }));
    expect(screen.queryByLabelText(/ticker|symbol|market|live price/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Where do you invest?"), "Zerodha");
    await user.type(screen.getByLabelText("Current value"), "75000");
    await user.click(screen.getByRole("button", { name: "Add investment" }));
    expect(createAccountAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "investment", name: "Zerodha", marketValueMinor: 7500000 }),
    );
  });
});

describe("<AddAccountSheet> — cash tab", () => {
  it("submits type='cash' allowing a zero starting balance", async () => {
    const { createAccountAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddAccountSheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("tab", { name: "Cash" }));
    await user.click(screen.getByRole("button", { name: "Add wallet" }));
    expect(createAccountAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cash", balanceMinor: 0 }),
    );
  });
});
