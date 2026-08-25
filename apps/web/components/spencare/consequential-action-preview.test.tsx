import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConsequentialActionPreview,
  type ActionPreview,
} from "./consequential-action-preview";

const expensePreview: ActionPreview = {
  commandType: "createTransaction",
  summary: "I'll add ₹500 as a food expense from HDFC Bank.",
  fields: [
    { label: "Amount", value: "₹500.00" },
    { label: "Category", value: "Dining" },
    { label: "Account", value: "HDFC Bank" },
    { label: "Date", value: "Today, 25 Aug 2026" },
  ],
  effect: { label: "Safe to Spend", before: "₹22,123", after: "₹21,623" },
  undoable: true,
};

describe("ConsequentialActionPreview — proposed state", () => {
  it("renders the summary, structured fields, and effect delta", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" />);
    expect(
      screen.getByText("I'll add ₹500 as a food expense from HDFC Bank."),
    ).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("₹500.00")).toBeInTheDocument();
    expect(screen.getByText("Safe to Spend")).toBeInTheDocument();
    expect(screen.getByText("₹22,123 → ₹21,623")).toBeInTheDocument();
  });

  it("shows exactly two buttons: Cancel and Confirm", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("calls onConfirm only when Confirm is explicitly clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConsequentialActionPreview
        preview={expensePreview}
        state="proposed"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("CRITICAL SAFETY: Confirm is never the initially focused element", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" />);
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    expect(document.activeElement).not.toBe(confirmButton);
    expect(document.body).toHaveFocus(); // focus stayed on <body>, nothing auto-grabbed it
  });

  it("does not render a quick-reply-style single ambiguous action -- always both Cancel and Confirm together", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
  });
});

describe("ConsequentialActionPreview — expiry countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a text countdown, never color/motion-only (accessibility-requirements.md §10)", () => {
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000 + 32 * 1000); // 4:32
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" expiresAt={expiresAt} />);
    expect(screen.getByText("· Expires in 4:32")).toBeInTheDocument();
  });

  it("counts down as real time passes", async () => {
    const expiresAt = new Date(Date.now() + 65 * 1000); // 1:05
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" expiresAt={expiresAt} />);
    expect(screen.getByText("· Expires in 1:05")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.getByText("· Expires in 0:55")).toBeInTheDocument();
  });

  it("does not show a countdown outside the proposed state", () => {
    const expiresAt = new Date(Date.now() + 60 * 1000);
    render(
      <ConsequentialActionPreview preview={expensePreview} state="confirmed" expiresAt={expiresAt} />,
    );
    expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument();
  });
});

describe("ConsequentialActionPreview — confirming state", () => {
  it("disables both buttons and shows a spinner, never allowing a double-submit", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="confirming" />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeDisabled();
  });
});

describe("ConsequentialActionPreview — confirmed state", () => {
  it("shows past-tense confirmation styling and an Undo link when undoable", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="confirmed" />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    // No Cancel/Confirm pair remains once committed.
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });

  it("does NOT show an Undo action when preview.undoable is false", () => {
    render(
      <ConsequentialActionPreview
        preview={{ ...expensePreview, undoable: false }}
        state="confirmed"
      />,
    );
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("calls onUndo when Undo is clicked", async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    render(<ConsequentialActionPreview preview={expensePreview} state="confirmed" onUndo={onUndo} />);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe("ConsequentialActionPreview — cancelled state", () => {
  it("shows 'Nothing was changed' and no action buttons", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="cancelled" />);
    expect(screen.getByText("Nothing was changed.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render the structured fields once cancelled", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="cancelled" />);
    expect(screen.queryByText("Amount")).not.toBeInTheDocument();
  });
});

describe("ConsequentialActionPreview — expired state", () => {
  it("offers only 'Ask again', never a direct re-confirm of stale data", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(<ConsequentialActionPreview preview={expensePreview} state="expired" onRetry={onRetry} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("Ask again");
    await user.click(buttons[0]!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ConsequentialActionPreview — error state", () => {
  it("shows the specific error reason (api-architecture.md §3 stale-state rejection)", () => {
    render(
      <ConsequentialActionPreview
        preview={expensePreview}
        state="error"
        errorMessage="This account was deleted since you asked."
      />,
    );
    expect(screen.getByText("This account was deleted since you asked.")).toBeInTheDocument();
  });

  it("offers Try again and Cancel", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="error" errorMessage="x" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("ConsequentialActionPreview — accessibility semantics", () => {
  it('has role="group" with a descriptive aria-label', () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" />);
    expect(
      screen.getByRole("group", { name: /Proposed: I'll add ₹500 as a food expense/ }),
    ).toBeInTheDocument();
  });

  it("carries an aria-live polite status region that updates per state", () => {
    const { rerender } = render(
      <ConsequentialActionPreview preview={expensePreview} state="proposed" />,
    );
    let status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Proposed action/);
    expect(status).toHaveAttribute("aria-live", "polite");

    rerender(<ConsequentialActionPreview preview={expensePreview} state="confirmed" />);
    status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Confirmed/);
  });

  it("the live region is never aria-live=assertive (must not interrupt the user)", () => {
    render(<ConsequentialActionPreview preview={expensePreview} state="proposed" />);
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-live", "assertive");
  });
});
