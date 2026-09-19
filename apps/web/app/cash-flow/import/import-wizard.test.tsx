import { configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, CategoryRow, ImportBatchRow, StagedTransactionRow } from "@spencare/domain-application";
import { ImportWizard } from "./import-wizard";

// This file's own async transitions (upload -> processing -> review,
// confirm -> complete) each cross a real `startTransition`/`await` boundary
// -- RTL's default 1000ms `waitFor` timeout was observed to fail
// intermittently (once in ~15 runs) only when the full 48-file suite runs
// in parallel under heavier CPU contention, never in isolation. Not a
// logic race (every state update here is synchronous within one
// `startTransition` continuation, confirmed by reading the component) --
// a straightforward flaky-under-load timeout, so the fix is a longer
// budget for this file's own async waits, not a code change.
configure({ asyncUtilTimeout: 5000 });

vi.mock("./actions", () => ({
  createImportBatchAction: vi.fn(),
  listStagedTransactionsAction: vi.fn(),
  updateStagedTransactionAction: vi.fn(),
  confirmImportAction: vi.fn(),
  cancelImportAction: vi.fn(),
}));

const account: AccountRow = {
  id: "acc-1",
  user_id: "u1",
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
  statement_generated_day: null,
  payment_due_day: null,
};
const creditCardAccount: AccountRow = {
  ...account,
  id: "acc-2",
  type: "credit_card",
  name: "ICICI Credit Card",
  balance_minor: 0,
  credit_limit_minor: 10_000_000,
  credit_used_minor: 3_500_000,
};

const categories: CategoryRow[] = [{ id: "cat-1", user_id: null, name: "Dining", icon: null, is_system: true }];

function batch(overrides: Partial<ImportBatchRow> = {}): ImportBatchRow {
  return {
    id: "batch-1",
    user_id: "u1",
    source_type: "csv",
    account_id: "acc-1",
    file_name: "statement.csv",
    file_size_bytes: 100,
    status: "awaiting_review",
    confidence_summary: null,
    raw_extraction_ref: null,
    created_at: "2026-08-12T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
    confirmed_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function stagedRow(overrides: Partial<StagedTransactionRow> = {}): StagedTransactionRow {
  return {
    id: "staged-1",
    import_batch_id: "batch-1",
    user_id: "u1",
    raw_payload: {},
    normalized_amount_minor: 45000,
    normalized_date: "2026-08-12",
    normalized_merchant: "Swiggy",
    suggested_category_id: "cat-1",
    staged_transaction_type: "expense",
    confidence_score: 0.9,
    duplicate_of_transaction_id: null,
    review_status: "pending",
    created_transaction_id: null,
    created_at: "2026-08-12T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
    ...overrides,
  };
}

function makeFile(name = "statement.csv", type = "text/csv") {
  return new File(["Date,Amount,Description\n12/08/2026,-450,Swiggy\n"], name, { type });
}

beforeEach(() => vi.clearAllMocks());

describe("<ImportWizard> — accessibility", () => {
  it("has no axe violations on the upload step", async () => {
    const { container } = render(<ImportWizard accounts={[account]} categories={categories} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the empty-accounts state", async () => {
    const { container } = render(<ImportWizard accounts={[]} categories={categories} />);
    expect(screen.getByRole("link", { name: "Add an account" })).toHaveAttribute("href", "/settings/accounts");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<ImportWizard> — upload step", () => {
  it("shows an honest error and does not proceed when no file is chosen", async () => {
    const { createImportBatchAction } = await import("./actions");
    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Upload and process" }));
    expect(await screen.findByText(/choose a csv or pdf file/i)).toBeInTheDocument();
    expect(createImportBatchAction).not.toHaveBeenCalled();
  });

  it("shows a real (non-fabricated) processing state, then transitions to review on success", async () => {
    const { createImportBatchAction, listStagedTransactionsAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: true, value: batch() } as never);
    vi.mocked(listStagedTransactionsAction).mockResolvedValue([stagedRow()]);

    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    const fileInput = screen.getByLabelText("Statement file");
    await user.upload(fileInput, makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));

    await waitFor(() => expect(screen.getByText(/review 1 transaction/i)).toBeInTheDocument());
    expect(screen.queryByText(/%/)).not.toBeInTheDocument(); // no fake percentage anywhere
  });

  it("surfaces a real upload error and returns to the upload step", async () => {
    const { createImportBatchAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: false, error: { code: "invalid_file_content", message: "That file's contents don't match a supported statement format." } } as never);

    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    await user.upload(screen.getByLabelText("Statement file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));

    expect(await screen.findByText(/don't match a supported statement format/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload and process" })).toBeInTheDocument();
  });

  it("Phase 28: offers a Credit Card as an import destination, clearly labeled by type", async () => {
    render(<ImportWizard accounts={[account, creditCardAccount]} categories={categories} />);
    await userEvent.setup().click(screen.getByRole("combobox", { name: "Which account is this statement for?" }));
    expect(screen.getByRole("option", { name: "ICICI Credit Card · Credit Card" })).toBeInTheDocument();
  });

  it("Phase 28: warns that a credit-card statement's income rows can't be imported here, once a credit card is selected", async () => {
    const user = userEvent.setup();
    render(<ImportWizard accounts={[account, creditCardAccount]} categories={categories} />);
    expect(screen.queryByText(/can't be imported here/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Which account is this statement for?" }));
    await user.click(screen.getByRole("option", { name: "ICICI Credit Card · Credit Card" }));
    expect(screen.getByText(/can't be imported here/i)).toBeInTheDocument();
  });
});

describe("<ImportWizard> — review step", () => {
  async function renderAtReview(rows: StagedTransactionRow[]) {
    const { createImportBatchAction, listStagedTransactionsAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: true, value: batch() } as never);
    vi.mocked(listStagedTransactionsAction).mockResolvedValue(rows);
    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    await user.upload(screen.getByLabelText("Statement file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));
    await waitFor(() => expect(screen.getByText(/review 1 transaction/i)).toBeInTheDocument());
    return user;
  }

  it("flags a low-confidence row as needing review, with icon + text, not color alone", async () => {
    await renderAtReview([stagedRow({ confidence_score: 0.3 })]);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
  });

  it("does not flag a high-confidence row as needing review", async () => {
    await renderAtReview([stagedRow({ confidence_score: 0.95 })]);
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
  });

  it("shows a duplicate warning badge, never silently drops the row", async () => {
    await renderAtReview([stagedRow({ duplicate_of_transaction_id: "txn-existing" })]);
    expect(screen.getByText("Possible duplicate")).toBeInTheDocument();
    // still fully present and actionable, not removed from the list
    expect(screen.getByText("Swiggy")).toBeInTheDocument();
  });

  it("lets the user accept a row", async () => {
    const { updateStagedTransactionAction } = await import("./actions");
    vi.mocked(updateStagedTransactionAction).mockResolvedValue({ ok: true, value: stagedRow({ review_status: "accepted" }) } as never);
    const user = await renderAtReview([stagedRow()]);
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(updateStagedTransactionAction).toHaveBeenCalledWith("staged-1", { reviewStatus: "accepted" });
  });

  it("lets the user reject a row -- rejection is explicit, not automatic for duplicates", async () => {
    const { updateStagedTransactionAction } = await import("./actions");
    vi.mocked(updateStagedTransactionAction).mockResolvedValue({ ok: true, value: stagedRow({ review_status: "rejected" }) } as never);
    const user = await renderAtReview([stagedRow({ duplicate_of_transaction_id: "txn-existing" })]);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(updateStagedTransactionAction).toHaveBeenCalledWith("staged-1", { reviewStatus: "rejected" });
  });

  it("disables Continue when nothing has been accepted/edited yet", async () => {
    await renderAtReview([stagedRow()]);
    expect(screen.getByRole("button", { name: /continue \(0 to import\)/i })).toBeDisabled();
  });

  it("enables Continue once a row is accepted", async () => {
    await renderAtReview([stagedRow({ review_status: "accepted" })]);
    expect(screen.getByRole("button", { name: /continue \(1 to import\)/i })).toBeEnabled();
  });

  it("has no axe violations in the review step", async () => {
    const { container } = render(<ImportWizard accounts={[account]} categories={categories} />);
    const { createImportBatchAction, listStagedTransactionsAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: true, value: batch() } as never);
    vi.mocked(listStagedTransactionsAction).mockResolvedValue([stagedRow({ duplicate_of_transaction_id: "t1" }), stagedRow({ id: "staged-2", confidence_score: 0.2 })]);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Statement file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));
    await waitFor(() => expect(screen.getByText(/review 2 transactions/i)).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<ImportWizard> — confirm + complete", () => {
  it("shows the ConsequentialActionPreview and never offers Undo (confirmImport is non-undoable)", async () => {
    const { createImportBatchAction, listStagedTransactionsAction, confirmImportAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: true, value: batch() } as never);
    vi.mocked(listStagedTransactionsAction).mockResolvedValue([stagedRow({ review_status: "accepted" })]);
    vi.mocked(confirmImportAction).mockResolvedValue({ ok: true, value: { batch: batch({ status: "confirmed" }), summary: { imported: 1, skipped: 0, duplicatesSkipped: 0 } } } as never);

    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    await user.upload(screen.getByLabelText("Statement file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));
    await waitFor(() => screen.getByText(/review 1 transaction/i));
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getAllByText(/import 1 transaction into hdfc bank/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByText("Import complete")).toBeInTheDocument());
    expect(screen.getByText("Import complete")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo/i })).not.toBeInTheDocument();
  });

  it("shows an honest summary matching what the server actually returned", async () => {
    const { createImportBatchAction, listStagedTransactionsAction, confirmImportAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: true, value: batch() } as never);
    vi.mocked(listStagedTransactionsAction).mockResolvedValue([stagedRow({ review_status: "accepted" })]);
    vi.mocked(confirmImportAction).mockResolvedValue({ ok: true, value: { batch: batch({ status: "confirmed" }), summary: { imported: 1, skipped: 2, duplicatesSkipped: 1 } } } as never);

    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    await user.upload(screen.getByLabelText("Statement file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));
    await waitFor(() => screen.getByText(/review 1 transaction/i));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => screen.getByText("Import complete"));
    const dl = screen.getByText("Imported").closest("dl")!;
    expect(within(dl).getByText("Imported").nextElementSibling).toHaveTextContent("1");
    expect(within(dl).getByText("Skipped").nextElementSibling).toHaveTextContent("2");
    expect(within(dl).getByText("Flagged as duplicates").nextElementSibling).toHaveTextContent("1");
  });

  it("shows a real error message and lets the user retry when confirmation fails", async () => {
    const { createImportBatchAction, listStagedTransactionsAction, confirmImportAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: true, value: batch() } as never);
    vi.mocked(listStagedTransactionsAction).mockResolvedValue([stagedRow({ review_status: "accepted" })]);
    vi.mocked(confirmImportAction).mockResolvedValue({ ok: false, error: { code: "category_required", message: "Every accepted row needs a category before you can confirm." } } as never);

    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    await user.upload(screen.getByLabelText("Statement file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));
    await waitFor(() => screen.getByText(/review 1 transaction/i));
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    const matches = await screen.findAllByText(/every accepted row needs a category/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("<ImportWizard> — cancel", () => {
  it("cancels the import and returns to the upload step", async () => {
    const { createImportBatchAction, listStagedTransactionsAction, cancelImportAction } = await import("./actions");
    vi.mocked(createImportBatchAction).mockResolvedValue({ ok: true, value: batch() } as never);
    vi.mocked(listStagedTransactionsAction).mockResolvedValue([stagedRow()]);
    vi.mocked(cancelImportAction).mockResolvedValue({ ok: true, value: undefined } as never);

    const user = userEvent.setup();
    render(<ImportWizard accounts={[account]} categories={categories} />);
    await user.upload(screen.getByLabelText("Statement file"), makeFile());
    await user.click(screen.getByRole("button", { name: "Upload and process" }));
    await waitFor(() => screen.getByText(/review 1 transaction/i));
    await user.click(screen.getByRole("button", { name: "Cancel import" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Upload and process" })).toBeInTheDocument());
    expect(cancelImportAction).toHaveBeenCalledWith("batch-1");
  });
});
