import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryRow } from "@spencare/domain-application";
import { CreateCategorySheet } from "./create-category-sheet";

vi.mock("@/app/cash-flow/transactions/actions", () => ({
  createCategoryAction: vi.fn(async () => ({ ok: true, value: { id: "new-cat-id", user_id: "u1", name: "Subscriptions", icon: null, is_system: false } as CategoryRow })),
}));
vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

beforeEach(async () => {
  const { createCategoryAction } = await import("@/app/cash-flow/transactions/actions");
  vi.mocked(createCategoryAction).mockReset();
  vi.mocked(createCategoryAction).mockResolvedValue({
    ok: true,
    value: { id: "new-cat-id", user_id: "u1", name: "Subscriptions", icon: null, is_system: false } as CategoryRow,
  });
  const { toastConfirmed, toastError } = await import("@/lib/toast");
  vi.mocked(toastConfirmed).mockReset();
  vi.mocked(toastError).mockReset();
});

describe("<CreateCategorySheet> — accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <CreateCategorySheet open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("submit button is touch-sized (44px minimum target)", () => {
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: "Create category" })).toHaveAttribute("data-size", "touch");
  });
});

describe("<CreateCategorySheet> — behavior", () => {
  it("requires a name before submitting", async () => {
    const { createCategoryAction } = await import("@/app/cash-flow/transactions/actions");
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(createCategoryAction).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a category name.")).toBeInTheDocument();
  });

  it("submits with name only (no icon required)", async () => {
    const { createCategoryAction } = await import("@/app/cash-flow/transactions/actions");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Category name"), "Subscriptions");
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(createCategoryAction).toHaveBeenCalledWith({ name: "Subscriptions", icon: null });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ name: "Subscriptions" }));
  });

  it("selects an icon and submits it with the form", async () => {
    const { createCategoryAction } = await import("@/app/cash-flow/transactions/actions");
    vi.mocked(createCategoryAction).mockResolvedValue({
      ok: true,
      value: { id: "new-cat-id", user_id: "u1", name: "Dining out", icon: "Utensils", is_system: false } as CategoryRow,
    });
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.type(screen.getByLabelText("Category name"), "Dining out");
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(createCategoryAction).toHaveBeenCalledWith({ name: "Dining out", icon: "Utensils" });
  });

  it("clicking a selected icon deselects it (toggles off)", async () => {
    const { createCategoryAction } = await import("@/app/cash-flow/transactions/actions");
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.type(screen.getByLabelText("Category name"), "Misc");
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.click(screen.getByRole("option", { name: "Dining" }));
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(createCategoryAction).toHaveBeenCalledWith({ name: "Misc", icon: null });
  });

  it("filters icons by search query", async () => {
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={() => {}} />);
    const searchInput = screen.getByLabelText("Search icons");
    await user.type(searchInput, "car");
    expect(screen.getByRole("option", { name: "Car" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Dining" })).not.toBeInTheDocument();
  });

  it("shows 'No icons found' when search matches nothing", async () => {
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.type(screen.getByLabelText("Search icons"), "zzzznotanicon");
    expect(screen.getByText("No icons found.")).toBeInTheDocument();
  });

  it("shows a toast and calls onCreated after successful creation", async () => {
    const { toastConfirmed } = await import("@/lib/toast");
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Category name"), "Subscriptions");
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(toastConfirmed).toHaveBeenCalledWith('"Subscriptions" category created.');
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("shows a toast error and does not call onCreated on server failure", async () => {
    const { createCategoryAction } = await import("@/app/cash-flow/transactions/actions");
    const { toastError } = await import("@/lib/toast");
    vi.mocked(createCategoryAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "duplicate_name", message: "You already have a category with that name." },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreateCategorySheet open onOpenChange={() => {}} onCreated={onCreated} />);
    await user.type(screen.getByLabelText("Category name"), "Dining");
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(toastError).toHaveBeenCalledWith("You already have a category with that name.");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
