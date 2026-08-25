import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

describe("<ConfirmDialog>", () => {
  it("renders title, description, and consequence list when open", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete my account?"
        description="This action is permanent and cannot be undone."
        consequences={["Transaction history and insights", "All your accounts and balances"]}
        confirmLabel="Verify & delete"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText("Delete my account?")).toBeInTheDocument();
    expect(screen.getByText("This action is permanent and cannot be undone.")).toBeInTheDocument();
    expect(screen.getByText("Transaction history and insights")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Delete my account?"
        confirmLabel="Verify & delete"
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText("Delete my account?")).not.toBeInTheDocument();
  });

  it("evidenced button-order convention: destructive action is data-variant=destructive (outline), Cancel is data-variant=default (solid)", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Deactivate AI Brain?"
        confirmLabel="Deactivate"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Deactivate" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-variant", "default");
  });

  it("calls onConfirm when the destructive action is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete goal?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete goal?"
        confirmLabel="Delete"
        onConfirm={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders as an accessible dialog with the title as its accessible name", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete my account?"
        confirmLabel="Delete"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Delete my account?" })).toBeInTheDocument();
  });
});
