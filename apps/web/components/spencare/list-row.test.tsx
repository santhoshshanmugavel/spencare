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
    expect(screen.getByText("Subscriptions")).toBeInTheDocument();
    expect(screen.getByText("HDFC Bank")).toBeInTheDocument();
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
    expect(row).toHaveAttribute("tabindex", "0");

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
});
