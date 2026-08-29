import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpSessionStatus } from "@spencare/domain-application";
import { McpSessionManager } from "./mcp-session-manager";
import { createMcpSessionAction, revokeMcpSessionAction } from "../actions";

vi.mock("../actions", () => ({
  createMcpSessionAction: vi.fn(),
  revokeMcpSessionAction: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

// @testing-library/user-event installs its own navigator.clipboard stub the
// moment userEvent.setup() runs (replacing anything defined beforehand), so
// the spy has to be attached *after* setup() in each test that needs it.
function spyOnClipboardWrite() {
  return vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
}

function session(overrides: Partial<McpSessionStatus> = {}): McpSessionStatus {
  return {
    id: "s1",
    clientName: "Claude Desktop",
    scopes: ["read"],
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<McpSessionManager> — empty state", () => {
  it("shows the generate form and no sessions", () => {
    render(<McpSessionManager initialSessions={[]} />);
    expect(screen.getByLabelText("Client name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate token" })).toBeInTheDocument();
    expect(screen.getByText("No tokens yet.")).toBeInTheDocument();
  });

  it("Read is checked by default, Write is not", () => {
    render(<McpSessionManager initialSessions={[]} />);
    expect(screen.getByRole("checkbox", { name: /Read/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Write/ })).not.toBeChecked();
  });
});

describe("<McpSessionManager> — create validation", () => {
  it("rejects submission with no client name, and never calls the action", async () => {
    const user = userEvent.setup();
    render(<McpSessionManager initialSessions={[]} />);
    await user.click(screen.getByRole("button", { name: "Generate token" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/name/i);
    expect(createMcpSessionAction).not.toHaveBeenCalled();
  });

  it("rejects submission with no scope selected", async () => {
    const user = userEvent.setup();
    render(<McpSessionManager initialSessions={[]} />);
    await user.type(screen.getByLabelText("Client name"), "Claude Desktop");
    await user.click(screen.getByRole("checkbox", { name: /Read/ })); // uncheck the only default scope
    await user.click(screen.getByRole("button", { name: "Generate token" }));

    expect(await screen.findByText(/at least one permission/i)).toBeInTheDocument();
    expect(createMcpSessionAction).not.toHaveBeenCalled();
  });
});

describe("<McpSessionManager> — create flow / one-time reveal", () => {
  it("on success, shows the plaintext token exactly once, and it disappears once dismissed", async () => {
    const user = userEvent.setup();
    vi.mocked(createMcpSessionAction).mockResolvedValue({
      token: "spc_mcp_plaintext-secret-value",
      session: session(),
    });

    render(<McpSessionManager initialSessions={[]} />);
    await user.type(screen.getByLabelText("Client name"), "Claude Desktop");
    await user.click(screen.getByRole("button", { name: "Generate token" }));

    await waitFor(() => expect(screen.getByText("spc_mcp_plaintext-secret-value")).toBeInTheDocument());
    expect(createMcpSessionAction).toHaveBeenCalledWith({ clientName: "Claude Desktop", scopes: ["read"] });
    // The new session is now listed too.
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I've saved it" }));
    expect(screen.queryByText("spc_mcp_plaintext-secret-value")).not.toBeInTheDocument();
    // The generate form is back, and there is no way to re-reveal it.
    expect(screen.getByRole("button", { name: "Generate token" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show|reveal/i })).not.toBeInTheDocument();
  });

  it("Copy writes the token to the clipboard, never to a downloadable link or query param", async () => {
    const user = userEvent.setup();
    const writeText = spyOnClipboardWrite();
    vi.mocked(createMcpSessionAction).mockResolvedValue({ token: "spc_mcp_copy-me", session: session() });

    render(<McpSessionManager initialSessions={[]} />);
    await user.type(screen.getByLabelText("Client name"), "Claude Desktop");
    await user.click(screen.getByRole("button", { name: "Generate token" }));
    await waitFor(() => expect(screen.getByText("spc_mcp_copy-me")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(writeText).toHaveBeenCalledWith("spc_mcp_copy-me");
  });

  it("on failure, shows an error toast and never enters the reveal state", async () => {
    const { toastError } = await import("@/lib/toast");
    vi.mocked(createMcpSessionAction).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();

    render(<McpSessionManager initialSessions={[]} />);
    await user.type(screen.getByLabelText("Client name"), "Claude Desktop");
    await user.click(screen.getByRole("button", { name: "Generate token" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByText(/spc_mcp_/)).not.toBeInTheDocument();
  });
});

describe("<McpSessionManager> — existing sessions list", () => {
  it("shows client name, scopes, and Active badge for a live session", () => {
    render(<McpSessionManager initialSessions={[session({ scopes: ["read", "write"] })]} />);
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("write")).toBeInTheDocument();
  });

  it("shows Revoked for a revoked session and no Revoke button", () => {
    render(<McpSessionManager initialSessions={[session({ revokedAt: "2026-08-15T00:00:00.000Z" })]} />);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("shows Expired for a session past its expiry and no Revoke button", () => {
    render(<McpSessionManager initialSessions={[session({ expiresAt: "2020-01-01T00:00:00.000Z" })]} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("never renders a token or token hash anywhere in the list", () => {
    render(<McpSessionManager initialSessions={[session()]} />);
    expect(screen.queryByText(/spc_mcp_/)).not.toBeInTheDocument();
  });
});

describe("<McpSessionManager> — revoke flow", () => {
  it("Revoke opens a ConfirmDialog naming the client, and does not revoke immediately", async () => {
    const user = userEvent.setup();
    render(<McpSessionManager initialSessions={[session()]} />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    const dialog = screen.getByRole("dialog", { name: "Revoke this token?" });
    expect(within(dialog).getByText(/Claude Desktop/)).toBeInTheDocument();
    expect(revokeMcpSessionAction).not.toHaveBeenCalled();
  });

  it("Cancel in the dialog leaves the session active", async () => {
    const user = userEvent.setup();
    render(<McpSessionManager initialSessions={[session()]} />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(revokeMcpSessionAction).not.toHaveBeenCalled();
  });

  it("confirming revoke calls the action with the session id and flips the badge to Revoked", async () => {
    const user = userEvent.setup();
    vi.mocked(revokeMcpSessionAction).mockResolvedValue(undefined);

    render(<McpSessionManager initialSessions={[session({ id: "s-target" })]} />);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke this token?" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(revokeMcpSessionAction).toHaveBeenCalledWith("s-target"));
    await waitFor(() => expect(screen.getByText("Revoked")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });
});

describe("<McpSessionManager> — accessibility", () => {
  it("has no axe violations in the empty/generate state", async () => {
    const { container } = render(<McpSessionManager initialSessions={[]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with existing sessions listed", async () => {
    const { container } = render(<McpSessionManager initialSessions={[session(), session({ id: "s2", revokedAt: "2026-08-01T00:00:00.000Z" })]} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the one-time reveal state", async () => {
    const user = userEvent.setup();
    vi.mocked(createMcpSessionAction).mockResolvedValue({ token: "spc_mcp_reveal", session: session() });
    const { container } = render(<McpSessionManager initialSessions={[]} />);
    await user.type(screen.getByLabelText("Client name"), "Claude Desktop");
    await user.click(screen.getByRole("button", { name: "Generate token" }));
    await waitFor(() => expect(screen.getByText("spc_mcp_reveal")).toBeInTheDocument());

    expect(await axe(container)).toHaveNoViolations();
  });
});
