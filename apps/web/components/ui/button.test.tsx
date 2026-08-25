import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";

/**
 * touch-target token verification (accessibility-requirements.md §5, §10).
 *
 * jsdom has no layout engine -- getBoundingClientRect() always reports 0 for
 * every element here, so a real rendered-pixel assertion is not possible in
 * this test environment (and must not be faked). Instead this test verifies
 * the DESIGN CONTRACT the CSS relies on: the "touch" size's height/min-width
 * utilities resolve to at least 44px on Tailwind's default spacing scale
 * (1 unit = 0.25rem = 4px -- the same scale NavigationRail's `size-11` and
 * PinOtpInput's `size-12` already rely on elsewhere in this codebase), by
 * parsing the actual generated class list rather than string-matching a
 * hardcoded token name.
 */
function tailwindSpacingToPx(token: string): number | null {
  const match = /^(?:h|w|min-h|min-w|size)-(\d+(?:\.\d+)?)$/.exec(token);
  if (!match) return null;
  return parseFloat(match[1]) * 4;
}

describe("buttonVariants — touch size token", () => {
  it("resolves a height utility to at least 44px", () => {
    const classes = buttonVariants({ size: "touch" }).split(/\s+/);
    const heightPx = classes
      .filter((c) => /^h-/.test(c))
      .map(tailwindSpacingToPx)
      .find((px): px is number => px !== null);
    expect(heightPx).toBeDefined();
    expect(heightPx as number).toBeGreaterThanOrEqual(44);
  });

  it("resolves a min-width utility to at least 44px (floor, not a cap, so labels can still grow the button)", () => {
    const classes = buttonVariants({ size: "touch" }).split(/\s+/);
    const minWidthPx = classes
      .filter((c) => /^min-w-/.test(c))
      .map(tailwindSpacingToPx)
      .find((px): px is number => px !== null);
    expect(minWidthPx).toBeDefined();
    expect(minWidthPx as number).toBeGreaterThanOrEqual(44);
  });

  it("the default and sm sizes remain below 44px (regression guard: proves this test would actually fail on the original bug)", () => {
    for (const size of ["default", "sm"] as const) {
      const classes = buttonVariants({ size }).split(/\s+/);
      const heightPx = classes
        .filter((c) => /^h-/.test(c))
        .map(tailwindSpacingToPx)
        .find((px): px is number => px !== null);
      expect(heightPx as number).toBeLessThan(44);
    }
  });
});

describe("<Button> — rendered contract", () => {
  it("exposes its resolved size via data-size, so consumers/tests can assert the real wiring, not just the variant definition", () => {
    render(<Button size="touch">Confirm</Button>);
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveAttribute("data-size", "touch");
  });

  it("a disabled touch-sized button keeps its size contract (hit area doesn't shrink when disabled)", () => {
    render(
      <Button size="touch" disabled>
        Confirm
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Confirm" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-size", "touch");
  });
});
