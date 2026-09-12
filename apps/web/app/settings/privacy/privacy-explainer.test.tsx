import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PrivacyExplainer } from "./privacy-explainer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/settings/actions", () => ({ updatePrivacyModeAction: vi.fn(async () => ({ ok: true, value: {} })) }));
vi.mock("@/lib/toast", () => ({ toastConfirmed: vi.fn(), toastError: vi.fn() }));

/**
 * Part 4's exact requirement: the user should understand the feature
 * "without reading documentation" -- progressive disclosure via short,
 * scannable sections (Financial amounts / Charts / Spensa), not a wall
 * of text, and each section names a REAL, verified redaction surface
 * (see privacy-mode-ux.md's own "what's actually redacted" audit) --
 * never a claim about protection the product doesn't actually provide.
 */
describe("<PrivacyExplainer>", () => {
  it("states the feature's purpose in one plain sentence", () => {
    render(
      <TooltipProvider>
        <PrivacyExplainer initialEnabled={false} />
      </TooltipProvider>,
    );
    expect(
      screen.getByText(/privacy mode hides financial amounts while you're using spencare/i),
    ).toBeInTheDocument();
  });

  it("names all three redaction surfaces the product actually has -- amounts, charts, and Spensa", () => {
    render(
      <TooltipProvider>
        <PrivacyExplainer initialEnabled={false} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Financial amounts")).toBeInTheDocument();
    expect(screen.getByText("Charts")).toBeInTheDocument();
    expect(screen.getByText("Spensa")).toBeInTheDocument();
  });

  it("includes the full settings-variant toggle with its own explicit On/Off state", () => {
    render(
      <TooltipProvider>
        <PrivacyExplainer initialEnabled />
      </TooltipProvider>,
    );
    expect(screen.getByRole("switch", { name: "Privacy Mode" })).toBeInTheDocument();
    expect(screen.getByText(/on — amounts are hidden/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <TooltipProvider>
        <PrivacyExplainer initialEnabled={false} />
      </TooltipProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
