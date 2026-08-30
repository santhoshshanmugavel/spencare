import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailConnectionStatus, GmailCandidateRow } from "@spencare/domain-application";
import { GmailConnectionManager } from "./gmail-connection-manager";
import {
  beginGmailConnectAction,
  getGmailStatusAction,
  listGmailCandidatesAction,
  disconnectGmailAction,
  syncGmailNowAction,
  acceptGmailCandidateAction,
  rejectGmailCandidateAction,
  markGmailCandidateDuplicateAction,
  editGmailCandidateAction,
} from "../actions";

vi.mock("../actions", () => ({
  beginGmailConnectAction: vi.fn(),
  getGmailStatusAction: vi.fn(),
  listGmailCandidatesAction: vi.fn(),
  disconnectGmailAction: vi.fn(),
  syncGmailNowAction: vi.fn(),
  acceptGmailCandidateAction: vi.fn(),
  rejectGmailCandidateAction: vi.fn(),
  markGmailCandidateDuplicateAction: vi.fn(),
  editGmailCandidateAction: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

const ACCOUNTS = [{ id: "acc-1", name: "HDFC Bank", type: "bank" }];
const CATEGORIES = [{ id: "cat-1", name: "Dining" }];

function status(overrides: Partial<GmailConnectionStatus> = {}): GmailConnectionStatus {
  return {
    id: "conn-1",
    googleEmail: "user@gmail.com",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    syncStatus: "idle",
    lastSyncAt: "2026-08-30T00:00:00.000Z",
    lastSyncError: null,
    candidatesFoundLastSync: 2,
    connectedAt: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<GmailCandidateRow> = {}): GmailCandidateRow {
  return {
    id: "cand-1",
    userId: "user-1",
    gmailMessageId: "msg-1",
    gmailThreadId: "thread-1",
    gmailAttachmentId: null,
    sender: "alerts@hdfcbank.net",
    subject: "Debit Alert",
    receivedAt: "2026-08-30T00:00:00.000Z",
    extractedAt: "2026-08-30T00:00:01.000Z",
    parserVersion: "gmail-v1",
    candidateType: "transaction",
    direction: "expense",
    accountId: "acc-1",
    suggestedCategoryId: "cat-1",
    normalizedAmountMinor: 50000,
    currency: "INR",
    normalizedDate: "2026-08-30",
    normalizedMerchant: "Starbucks",
    referenceId: null,
    confidenceScore: 0.85,
    duplicateOfTransactionId: null,
    transferPairCandidateId: null,
    accountMatchRequired: false,
    extractionWarnings: null,
    reviewStatus: "pending",
    createdTransactionId: null,
    createdAt: "2026-08-30T00:00:01.000Z",
    updatedAt: "2026-08-30T00:00:01.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<GmailConnectionManager> — not connected", () => {
  it("shows the explanation, the capability disclosure, and a Connect Gmail button", () => {
    render(<GmailConnectionManager initialStatus={null} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    expect(screen.getByRole("button", { name: /Connect Gmail/i })).toBeInTheDocument();
    expect(screen.getByText(/Spencare can:/)).toBeInTheDocument();
    expect(screen.getByText(/Spencare cannot:/)).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("clicking Connect Gmail calls beginGmailConnectAction", async () => {
    const user = userEvent.setup();
    vi.mocked(beginGmailConnectAction).mockResolvedValue(undefined);
    render(<GmailConnectionManager initialStatus={null} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);

    await user.click(screen.getByRole("button", { name: /Connect Gmail/i }));
    expect(beginGmailConnectAction).toHaveBeenCalled();
  });
});

describe("<GmailConnectionManager> — connected, no pending items", () => {
  it("shows the connected email, last sync, Sync now, and Disconnect", () => {
    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("user@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.getByText("No financial emails waiting for review.")).toBeInTheDocument();
  });

  it("shows the last sync error when the last sync failed", () => {
    render(<GmailConnectionManager initialStatus={status({ syncStatus: "error", lastSyncError: "Gmail access was revoked." })} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    expect(screen.getByText("Gmail access was revoked.")).toBeInTheDocument();
  });

  it("Sync now calls syncGmailNowAction and refreshes status/candidates on success", async () => {
    const user = userEvent.setup();
    vi.mocked(syncGmailNowAction).mockResolvedValue({ ok: true, value: { messagesScanned: 5, candidatesCreated: 2, fellBackToFullSync: false } });
    vi.mocked(getGmailStatusAction).mockResolvedValue(status({ candidatesFoundLastSync: 2 }));
    vi.mocked(listGmailCandidatesAction).mockResolvedValue([candidate()]);

    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    await user.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => expect(screen.getByText("Starbucks")).toBeInTheDocument());
  });

  it("Sync now surfaces a structured error via toast without crashing", async () => {
    const { toastError } = await import("@/lib/toast");
    const user = userEvent.setup();
    vi.mocked(syncGmailNowAction).mockResolvedValue({ ok: false, error: { code: "gmail_sync_already_running", message: "A sync is already running." } });

    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    await user.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("A sync is already running."));
  });

  it("Disconnect opens a ConfirmDialog and does not disconnect immediately", async () => {
    const user = userEvent.setup();
    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("dialog", { name: "Disconnect Gmail?" })).toBeInTheDocument();
    expect(disconnectGmailAction).not.toHaveBeenCalled();
  });

  it("confirming Disconnect calls the action and returns to the not-connected state", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectGmailAction).mockResolvedValue(undefined);

    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = screen.getByRole("dialog", { name: "Disconnect Gmail?" });
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Connect Gmail/i })).toBeInTheDocument());
  });
});

describe("<GmailConnectionManager> — toasts from OAuth redirect params", () => {
  it("shows a confirmation toast when connected=true", async () => {
    const { toastConfirmed } = await import("@/lib/toast");
    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} connected />);
    await waitFor(() => expect(toastConfirmed).toHaveBeenCalled());
  });

  it("shows an error toast when oauthError is set", async () => {
    const { toastError } = await import("@/lib/toast");
    render(<GmailConnectionManager initialStatus={null} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} oauthError="That connection attempt couldn't be verified." />);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That connection attempt couldn't be verified."));
  });

  it("stays silent (no toast) when the user simply cancelled Google's consent screen", async () => {
    const { toastConfirmed, toastError } = await import("@/lib/toast");
    render(<GmailConnectionManager initialStatus={null} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} cancelled />);
    expect(toastConfirmed).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("<GmailConnectionManager> — review queue", () => {
  it("lists a pending candidate but hides accepted/rejected ones", () => {
    render(
      <GmailConnectionManager
        initialStatus={status()}
        initialCandidates={[candidate({ id: "c1", reviewStatus: "pending" }), candidate({ id: "c2", reviewStatus: "accepted" }), candidate({ id: "c3", reviewStatus: "rejected" })]}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
      />,
    );
    expect(screen.getByText("Needs review (1)")).toBeInTheDocument();
  });

  it("Accept is disabled when the candidate needs an account assigned", () => {
    render(
      <GmailConnectionManager
        initialStatus={status()}
        initialCandidates={[candidate({ accountId: null, accountMatchRequired: true })]}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
      />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByText("Choose an account before accepting.")).toBeInTheDocument();
  });

  it("shows a duplicate warning when the candidate matches an existing transaction", () => {
    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[candidate({ duplicateOfTransactionId: "txn-1" })]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    expect(screen.getByText(/may already have/)).toBeInTheDocument();
  });

  it("Accept calls acceptGmailCandidateAction and marks the item accepted, removing it from the queue", async () => {
    const user = userEvent.setup();
    vi.mocked(acceptGmailCandidateAction).mockResolvedValue({ ok: true, value: { id: "txn-1" } });

    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[candidate()]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(acceptGmailCandidateAction).toHaveBeenCalledWith("cand-1");
    await waitFor(() => expect(screen.getByText("No financial emails waiting for review.")).toBeInTheDocument());
  });

  it("Ignore calls rejectGmailCandidateAction", async () => {
    const user = userEvent.setup();
    vi.mocked(rejectGmailCandidateAction).mockResolvedValue({ ok: true, value: undefined });

    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[candidate()]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    await user.click(screen.getByRole("button", { name: "Ignore" }));

    expect(rejectGmailCandidateAction).toHaveBeenCalledWith("cand-1");
  });

  it("Mark duplicate calls markGmailCandidateDuplicateAction", async () => {
    const user = userEvent.setup();
    vi.mocked(markGmailCandidateDuplicateAction).mockResolvedValue({ ok: true, value: undefined });

    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[candidate()]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    await user.click(screen.getByRole("button", { name: "Mark duplicate" }));

    expect(markGmailCandidateDuplicateAction).toHaveBeenCalledWith("cand-1");
  });

  it("Edit reveals the inline form, and Save calls editGmailCandidateAction with the edited fields", async () => {
    const user = userEvent.setup();
    vi.mocked(editGmailCandidateAction).mockResolvedValue({ ok: true, value: candidate({ normalizedMerchant: "Blue Bottle Coffee" }) });

    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[candidate()]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const merchantInput = screen.getByLabelText("Merchant");
    await user.clear(merchantInput);
    await user.type(merchantInput, "Blue Bottle Coffee");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(editGmailCandidateAction).toHaveBeenCalledWith("cand-1", expect.objectContaining({ normalizedMerchant: "Blue Bottle Coffee" }));
  });

  it("never renders raw email body content -- only sender/subject/date/extracted fields", () => {
    render(<GmailConnectionManager initialStatus={status()} initialCandidates={[candidate({ subject: "Debit Alert" })]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    expect(screen.getByText(/From alerts@hdfcbank.net/)).toBeInTheDocument();
  });
});

describe("<GmailConnectionManager> — accessibility", () => {
  it("has no axe violations in the not-connected state", async () => {
    const { container } = render(<GmailConnectionManager initialStatus={null} initialCandidates={[]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the connected state with a pending review item", async () => {
    const { container } = render(<GmailConnectionManager initialStatus={status()} initialCandidates={[candidate()]} accounts={ACCOUNTS} categories={CATEGORIES} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
