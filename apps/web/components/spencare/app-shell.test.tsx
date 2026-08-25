import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("<AppShell>", () => {
  it("renders the rail, header, and main content", () => {
    render(
      <AppShell rail={<div>RAIL</div>} header={<div>HEADER</div>}>
        <div>CONTENT</div>
      </AppShell>,
    );
    expect(screen.getByText("RAIL")).toBeInTheDocument();
    expect(screen.getByText("HEADER")).toBeInTheDocument();
    expect(screen.getByText("CONTENT")).toBeInTheDocument();
  });

  it("main content region is a <main> landmark", () => {
    render(<AppShell rail={<div />}>{"content"}</AppShell>);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("does not render the panel aside when no panel is given", () => {
    const { container } = render(<AppShell rail={<div />}>{"content"}</AppShell>);
    expect(container.querySelector("aside")).not.toBeInTheDocument();
  });

  it("renders the panel aside when panel content is given", () => {
    render(
      <AppShell rail={<div />} panel={<div>PANEL</div>}>
        content
      </AppShell>,
    );
    expect(screen.getByText("PANEL")).toBeInTheDocument();
  });
});
