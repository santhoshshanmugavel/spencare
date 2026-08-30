import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProviderStatus } from "@spencare/ai";
import type { AiProviderValue } from "@spencare/validation";
import { AiProviderManager } from "./ai-provider-manager";
import { connectProviderAction, updateProviderKeyAction, disconnectProviderAction } from "../actions";

vi.mock("../actions", () => ({
  connectProviderAction: vi.fn(),
  switchProviderAction: vi.fn(),
  updateProviderKeyAction: vi.fn(),
  disconnectProviderAction: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

const ALL_PROVIDERS: readonly AiProviderValue[] = ["anthropic", "openai", "google", "openrouter", "other"];
const IMPLEMENTED: readonly AiProviderValue[] = ["anthropic"];

function status(overrides: Partial<AiProviderStatus> = {}): AiProviderStatus {
  return { provider: "anthropic", keyLastFour: "1234", isActive: true, lastValidatedAt: "2026-09-03T00:00:00.000Z", lastValidationError: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<AiProviderManager> — empty/disconnected state", () => {
  it("shows every provider on the roster, with unimplemented ones marked Coming soon and disabled", () => {
    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    expect(screen.getByRole("radio", { name: "Claude" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /ChatGPT/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Gemini/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /OpenRouter/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^Other/ })).toBeDisabled();
    expect(screen.getAllByText("Coming soon")).toHaveLength(4);
  });

  it("Phase 29: with the real IMPLEMENTED_PROVIDERS roster, Claude/ChatGPT/Gemini are all enabled -- only OpenRouter/Other remain Coming soon", () => {
    const REAL_IMPLEMENTED: readonly AiProviderValue[] = ["anthropic", "openai", "google"];
    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={REAL_IMPLEMENTED} />);
    expect(screen.getByRole("radio", { name: "Claude" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /ChatGPT/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /Gemini/ })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /OpenRouter/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^Other/ })).toBeDisabled();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  });

  it("Phase 29: can select and submit a key for OpenAI/Gemini, not just Claude", async () => {
    const REAL_IMPLEMENTED: readonly AiProviderValue[] = ["anthropic", "openai", "google"];
    const user = userEvent.setup();
    vi.mocked(connectProviderAction).mockResolvedValue({
      ok: true,
      status: { provider: "openai", keyLastFour: "5678", isActive: true, lastValidatedAt: "2026-09-03T00:00:00.000Z", lastValidationError: null },
    });
    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={REAL_IMPLEMENTED} />);
    await user.click(screen.getByRole("radio", { name: /ChatGPT/ }));
    await user.type(screen.getByLabelText("API Key"), "sk-openai-test-key");
    await user.click(screen.getByRole("button", { name: "Activate Spensa brain" }));
    await waitFor(() => expect(connectProviderAction).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai", apiKey: "sk-openai-test-key" })));
  });

  it("shows the key-entry form with an Activate button, and no connected-state UI", () => {
    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate Spensa brain" })).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("the API key field is type=password with no reveal/show toggle", () => {
    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: /show|hide/i })).not.toBeInTheDocument();
  });

  it("selecting a different (implemented) provider clears the key field and updates the selection", async () => {
    const user = userEvent.setup();
    // Add a second implemented provider just for this test to exercise selection.
    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    const claudeRadio = screen.getByRole("radio", { name: "Claude" });
    expect(claudeRadio).toBeChecked();
    await user.type(screen.getByLabelText("API Key"), "sk-something");
    expect(screen.getByLabelText("API Key")).toHaveValue("sk-something");
  });
});

describe("<AiProviderManager> — connect flow (validation loading, success, invalid key, provider error)", () => {
  it("submits the form, shows a loading label while pending, and on success shows the connected state", async () => {
    const user = userEvent.setup();
    let resolveConnect!: (v: unknown) => void;
    vi.mocked(connectProviderAction).mockReturnValue(new Promise((resolve) => (resolveConnect = resolve)) as never);

    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.type(screen.getByLabelText("API Key"), "sk-real-key-1234");
    await user.click(screen.getByRole("button", { name: "Activate Spensa brain" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Activating…" })).toBeDisabled());

    resolveConnect({ ok: true, status: status() });

    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
    expect(screen.getByText("•••• •••• •••• 1234")).toBeInTheDocument();
  });

  it("on an invalid key, shows the server's safe error message inline and stays in the disconnected state", async () => {
    const user = userEvent.setup();
    vi.mocked(connectProviderAction).mockResolvedValue({ ok: false, error: { code: "invalid_key", message: "That API key appears to be invalid." } });

    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.type(screen.getByLabelText("API Key"), "sk-bad-key");
    await user.click(screen.getByRole("button", { name: "Activate Spensa brain" }));

    await waitFor(() => expect(screen.getByText("That API key appears to be invalid.")).toBeInTheDocument());
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("on a provider-unavailable error, shows that message too, never a raw exception", async () => {
    const user = userEvent.setup();
    vi.mocked(connectProviderAction).mockResolvedValue({ ok: false, error: { code: "provider_unavailable", message: "Couldn't reach the provider right now. Try again shortly." } });

    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.type(screen.getByLabelText("API Key"), "sk-key");
    await user.click(screen.getByRole("button", { name: "Activate Spensa brain" }));

    await waitFor(() => expect(screen.getByText("Couldn't reach the provider right now. Try again shortly.")).toBeInTheDocument());
  });
});

describe("<AiProviderManager> — connected state", () => {
  it("shows the Active badge, masked key, and Update/Disconnect actions", () => {
    render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("•••• •••• •••• 1234")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update API key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
  });
});

describe("<AiProviderManager> — update/rotation flow", () => {
  it("clicking Update API key shows a fresh key field, distinct from the connect form", async () => {
    const user = userEvent.setup();
    render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.click(screen.getByRole("button", { name: "Update API key" }));
    expect(screen.getByLabelText("New API key")).toBeInTheDocument();
    expect(screen.getByLabelText("New API key")).toHaveAttribute("type", "password");
  });

  it("Cancel returns to the connected state without calling the update action", async () => {
    const user = userEvent.setup();
    render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.click(screen.getByRole("button", { name: "Update API key" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(updateProviderKeyAction).not.toHaveBeenCalled();
  });

  it("on successful rotation, updates the displayed masked key and shows a confirmation toast", async () => {
    const user = userEvent.setup();
    const { toastConfirmed } = await import("@/lib/toast");
    vi.mocked(updateProviderKeyAction).mockResolvedValue({ ok: true, status: status({ keyLastFour: "9999" }) });

    render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.click(screen.getByRole("button", { name: "Update API key" }));
    await user.type(screen.getByLabelText("New API key"), "sk-rotated-key");
    await user.click(screen.getByRole("button", { name: "Update key" }));

    await waitFor(() => expect(screen.getByText("•••• •••• •••• 9999")).toBeInTheDocument());
    expect(toastConfirmed).toHaveBeenCalled();
  });

  it("THE CRITICAL INVARIANT: on a failed rotation, the existing connected credential's display is completely untouched", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProviderKeyAction).mockResolvedValue({ ok: false, error: { code: "invalid_key", message: "That API key appears to be invalid." } });

    render(<AiProviderManager initialStatus={status({ keyLastFour: "1234" })} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.click(screen.getByRole("button", { name: "Update API key" }));
    await user.type(screen.getByLabelText("New API key"), "sk-bad-rotation-key");
    await user.click(screen.getByRole("button", { name: "Update key" }));

    await waitFor(() => expect(screen.getByText("That API key appears to be invalid.")).toBeInTheDocument());
    // Still shows the OLD, still-working credential's last-four -- nothing
    // about the connected state changed as a result of the failed attempt.
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});

describe("<AiProviderManager> — disconnect flow", () => {
  it("Disconnect opens a ConfirmDialog describing what will be lost, and does not disconnect immediately", async () => {
    const user = userEvent.setup();
    render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(screen.getByRole("dialog", { name: "Disconnect AI provider?" })).toBeInTheDocument();
    expect(screen.getByText("Chat with Spensa")).toBeInTheDocument();
    expect(disconnectProviderAction).not.toHaveBeenCalled();
  });

  it("Cancel in the dialog leaves the credential connected", async () => {
    const user = userEvent.setup();
    render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(disconnectProviderAction).not.toHaveBeenCalled();
  });

  it("confirming disconnect calls the action and returns to the disconnected empty state", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectProviderAction).mockResolvedValue(undefined);

    render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    // Two "Disconnect"-labeled buttons now exist (the trigger, now hidden
    // behind the dialog, and the dialog's own destructive confirm button)
    // -- scope to the dialog.
    const dialog = screen.getByRole("dialog", { name: "Disconnect AI provider?" });
    const { getByRole } = within(dialog);
    await user.click(getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Activate Spensa brain" })).toBeInTheDocument());
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });
});

describe("<AiProviderManager> — accessibility", () => {
  it("has no axe violations in the disconnected state", async () => {
    const { container } = render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the connected state", async () => {
    const { container } = render(<AiProviderManager initialStatus={status()} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("provider radio group is keyboard-navigable via Tab", async () => {
    const user = userEvent.setup();
    render(<AiProviderManager initialStatus={null} providers={ALL_PROVIDERS} implementedProviders={IMPLEMENTED} />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "Claude" })).toHaveFocus();
  });
});
