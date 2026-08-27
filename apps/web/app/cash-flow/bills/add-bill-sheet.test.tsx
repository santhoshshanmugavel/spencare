import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow } from "@spencare/domain-application";
import { AddBillSheet } from "./add-bill-sheet";

vi.mock("./actions", () => ({
  createBillAction: vi.fn(async () => ({ ok: true, value: {} })),
}));
vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

beforeEach(async () => {
  const { createBillAction } = await import("./actions");
  vi.mocked(createBillAction).mockReset();
  vi.mocked(createBillAction).mockResolvedValue({ ok: true, value: {} as never });
  const { toastConfirmed, toastError } = await import("@/lib/toast");
  vi.mocked(toastConfirmed).mockReset();
  vi.mocked(toastError).mockReset();
});

const categories: CategoryRow[] = [
  { id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", user_id: null, name: "Bills & Utilities", icon: "receipt", is_system: true },
];

describe("<AddBillSheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(<AddBillSheet open onOpenChange={() => {}} onCreated={() => {}} categories={categories} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<AddBillSheet open onOpenChange={() => {}} onCreated={() => {}} categories={categories} />);
    expect(screen.getByRole("button", { name: "Add bill" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<AddBillSheet> — behavior", () => {
  it("requires a name before submitting", async () => {
    const { createBillAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddBillSheet open onOpenChange={() => {}} onCreated={() => {}} categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Add bill" }));
    expect(createBillAction).not.toHaveBeenCalled();
  });

  it("submits a bill with a known amount", async () => {
    const { createBillAction } = await import("./actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddBillSheet open onOpenChange={() => {}} onCreated={onCreated} categories={categories} />);
    await user.type(screen.getByLabelText("Bill name"), "Netflix");
    await user.type(screen.getByLabelText(/Expected amount/i), "499");
    await user.click(screen.getByRole("button", { name: "Add bill" }));
    expect(createBillAction).toHaveBeenCalledWith(
      expect.objectContaining({ merchantPattern: "Netflix", expectedAmountMinor: 49900, recurrenceInterval: "monthly" }),
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("submits a variable bill with NO amount -- never fabricates one", async () => {
    const { createBillAction } = await import("./actions");
    const user = userEvent.setup();
    render(<AddBillSheet open onOpenChange={() => {}} onCreated={() => {}} categories={categories} />);
    await user.type(screen.getByLabelText("Bill name"), "Electricity");
    await user.click(screen.getByRole("button", { name: "Add bill" }));
    expect(createBillAction).toHaveBeenCalledWith(
      expect.objectContaining({ merchantPattern: "Electricity", expectedAmountMinor: null }),
    );
  });

  it("defaults recurrence to monthly", () => {
    render(<AddBillSheet open onOpenChange={() => {}} onCreated={() => {}} categories={categories} />);
    expect(screen.getByRole("combobox", { name: "Repeats" })).toHaveTextContent("Monthly");
  });

  it("surfaces a server error without crashing or calling onCreated", async () => {
    const { createBillAction } = await import("./actions");
    const { toastError } = await import("@/lib/toast");
    vi.mocked(createBillAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "create_failed", message: "Couldn't create the bill. Try again." },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<AddBillSheet open onOpenChange={() => {}} onCreated={onCreated} categories={categories} />);
    await user.type(screen.getByLabelText("Bill name"), "Netflix");
    await user.click(screen.getByRole("button", { name: "Add bill" }));
    expect(toastError).toHaveBeenCalledWith("Couldn't create the bill. Try again.");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
