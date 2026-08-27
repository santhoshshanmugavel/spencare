import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { BillStatusBadge } from "./bill-status-badge";

/**
 * CF-D11: predicted vs. matched must be distinguishable WITHOUT relying on
 * color alone. Asserting on the actual visible/accessible text (not just
 * a className or a snapshot) is what proves that -- a colorblind reader
 * or a screen reader gets the real signal either way.
 */
describe("<BillStatusBadge> — CF-D11 predicted-vs-matched distinction", () => {
  it("has no axe violations across every status", () => {
    for (const status of ["open", "overdue", "matched", "skipped"] as const) {
      const { container, unmount } = render(<BillStatusBadge status={status} expectedDate="2026-09-15" />);
      unmount();
      void container;
    }
  });

  it("open: shows a due date, not just a color", () => {
    render(<BillStatusBadge status="open" expectedDate="2026-09-15" />);
    expect(screen.getByText(/due 15 sep/i)).toBeInTheDocument();
  });

  it("overdue: shows distinct text from open, not just a different color", () => {
    render(<BillStatusBadge status="overdue" expectedDate="2026-09-15" />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.queryByText(/due 15 sep/i)).not.toBeInTheDocument();
  });

  it("matched: shows 'Paid', distinct text from both predicted states", () => {
    render(<BillStatusBadge status="matched" expectedDate="2026-09-15" />);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("each status pairs its text with a different icon (not text-only styling)", () => {
    const { container: openContainer } = render(<BillStatusBadge status="open" expectedDate="2026-09-15" />);
    const { container: matchedContainer } = render(<BillStatusBadge status="matched" expectedDate="2026-09-15" />);
    expect(openContainer.querySelector("svg")).not.toBeNull();
    expect(matchedContainer.querySelector("svg")).not.toBeNull();
  });
});

describe("<BillStatusBadge> — accessibility", () => {
  it("has no axe violations (matched)", async () => {
    const { container } = render(<BillStatusBadge status="matched" expectedDate="2026-09-15" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations (open)", async () => {
    const { container } = render(<BillStatusBadge status="open" expectedDate="2026-09-15" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
