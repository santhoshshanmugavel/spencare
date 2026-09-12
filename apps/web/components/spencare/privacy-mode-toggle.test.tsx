import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrivacyModeToggle } from "./privacy-mode-toggle";

/** The rail variant's Tooltip needs a Provider ancestor -- in the real app this comes from the one wrapping the whole tree in app/layout.tsx; tests render standalone, same as navigation-rail.test.tsx's own setup. */
function renderRailToggle(props: Parameters<typeof PrivacyModeToggle>[0]) {
  return render(
    <TooltipProvider>
      <PrivacyModeToggle {...props} />
    </TooltipProvider>,
  );
}

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/settings/actions", () => ({
  updatePrivacyModeAction: vi.fn(async () => ({ ok: true, value: {} })),
}));

vi.mock("@/lib/toast", () => ({
  toastConfirmed: vi.fn(),
  toastError: vi.fn(),
}));

/**
 * Phase 32, Part 5's explicit toggle-behavior requirements: immediate
 * visual feedback, persistence via the canonical `updatePrivacyMode`
 * command (mocked here at the Server Action boundary), failure rollback,
 * and a toast either way -- never a silent failure, never an optimistic
 * UI left showing a state that didn't actually persist.
 */
describe("<PrivacyModeToggle> — rail variant (global, fast-access control)", () => {
  it("renders as a real toggle with a stated, non-icon-only accessible name reflecting current state", () => {
    renderRailToggle({ initialEnabled: false });
    expect(screen.getByRole("switch", { name: /privacy mode is off\. turn on\./i })).toBeInTheDocument();
  });

  it("reflects the ON state in its accessible name and aria-checked", () => {
    renderRailToggle({ initialEnabled: true });
    const toggle = screen.getByRole("switch", { name: /privacy mode is on\. turn off\./i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("gives immediate visual feedback on click, before the server responds", async () => {
    const user = userEvent.setup();
    renderRailToggle({ initialEnabled: false });
    await user.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch", { name: /privacy mode is on\. turn off\./i })).toBeInTheDocument();
  });

  it("shows a confirmed toast and refreshes the route on success", async () => {
    const { toastConfirmed } = await import("@/lib/toast");
    const user = userEvent.setup();
    renderRailToggle({ initialEnabled: false });
    await user.click(screen.getByRole("switch"));
    expect(await screen.findByRole("switch", { name: /privacy mode is on\. turn off\./i })).toBeInTheDocument();
    expect(toastConfirmed).toHaveBeenCalledWith("Privacy Mode turned on.");
    expect(refresh).toHaveBeenCalled();
  });

  it("REVERTS the optimistic state and shows an error toast when persistence fails -- never leaves a misleading UI state", async () => {
    const { updatePrivacyModeAction } = await import("@/app/settings/actions");
    vi.mocked(updatePrivacyModeAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "update_failed", message: "Couldn't update Privacy Mode. Try again." },
    });
    const { toastError } = await import("@/lib/toast");
    const user = userEvent.setup();
    renderRailToggle({ initialEnabled: false });
    await user.click(screen.getByRole("switch"));
    expect(await screen.findByRole("switch", { name: /privacy mode is off\. turn on\./i })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Couldn't update Privacy Mode. Try again.");
  });

  it("has no axe violations", async () => {
    const { container } = renderRailToggle({ initialEnabled: false });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<PrivacyModeToggle> — settings variant (explains the feature)", () => {
  it("shows the 'Privacy Mode' label and a real On/Off state sentence, never an unexplained icon alone", () => {
    render(<PrivacyModeToggle initialEnabled={false} variant="settings" />);
    expect(screen.getByText("Privacy Mode")).toBeInTheDocument();
    expect(screen.getByText(/off — amounts are visible/i)).toBeInTheDocument();
  });

  it("shows the On state sentence when enabled", () => {
    render(<PrivacyModeToggle initialEnabled variant="settings" />);
    expect(screen.getByText(/on — amounts are hidden/i)).toBeInTheDocument();
  });

  it("toggles via the Switch control and updates the state sentence immediately", async () => {
    const user = userEvent.setup();
    render(<PrivacyModeToggle initialEnabled={false} variant="settings" />);
    await user.click(screen.getByRole("switch", { name: "Privacy Mode" }));
    expect(await screen.findByText(/on — amounts are hidden/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<PrivacyModeToggle initialEnabled={false} variant="settings" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
