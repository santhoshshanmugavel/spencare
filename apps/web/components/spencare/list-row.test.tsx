import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListRow } from "./list-row";

describe("<ListRow>", () => {
  it("renders title, subtitle, metadata, and trailing content", () => {
    render(
      <ListRow
        title="Netflix"
        subtitle="You're paying for Netflix again"
        metadata={["Subscriptions", "HDFC Bank"]}
        trailing="₹499.00"
      />,
    );
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("You're paying for Netflix again")).toBeInTheDocument();
    // Metadata is now rendered twice -- once in the mobile-only stacked
    // row under the subtitle, once in the desktop-only inline columns --
    // so each category/account text node appears in the DOM twice. The
    // original single-match assertion predated the responsive split.
    expect(screen.getAllByText("Subscriptions").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("HDFC Bank").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("₹499.00")).toBeInTheDocument();
  });

  it("is not interactive (no button role) when no onClick is given", () => {
    render(<ListRow title="Netflix" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is keyboard-operable when onClick is provided (accessibility-requirements.md §1)", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<ListRow title="Netflix" onClick={onClick} />);

    const row = screen.getByRole("button");
    expect(row.tagName).toBe("BUTTON"); // natively focusable/tabbable, no explicit tabindex needed

    row.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("clicking the row calls onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<ListRow title="Netflix" onClick={onClick} />);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders metadata (category / account / time) visibly on mobile under the subtitle rather than hiding it", () => {
    // Pre-fix regression: metadata nodes carried `hidden sm:block`, so on
    // phones a transaction row dropped its category / account / time
    // entirely. The fix stacks them inside the main column with
    // `sm:hidden` so they ARE in the DOM at mobile widths; the desktop
    // columns stay `hidden ... sm:block` as a separate branch.
    render(
      <ListRow
        title="Swiggy"
        subtitle="Dinner"
        metadata={[<span key="cat">Dining</span>, <span key="acct">HDFC</span>, <span key="time">9:30 PM</span>]}
      />,
    );
    // Mobile stack: category / account / time all present (two copies
    // each -- one for the mobile stack, one for the desktop columns).
    expect(screen.getAllByText("Dining").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("HDFC").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("9:30 PM").length).toBeGreaterThanOrEqual(2);
  });
});
