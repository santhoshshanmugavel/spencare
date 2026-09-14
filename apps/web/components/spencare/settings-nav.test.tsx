import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { SettingsNav, SettingsShell } from "./settings-nav";

describe("<SettingsNav>", () => {
  it("lists every genuinely implemented section, in the design's original order, with net-new sections appended", () => {
    render(<SettingsNav active="profile" />);
    const links = screen.getAllByRole("link").map((el) => el.textContent);
    // Gmail is intentionally hidden from the nav (backend intact; re-add when re-enabled)
    expect(links).toEqual(["Accounts", "Spensa's Brain", "Profile", "Privacy", "Security", "Data & Backup", "MCP", "Categories", "Notifications"]);
  });

  it("lists Notifications and links to its settings page", () => {
    render(<SettingsNav active="profile" />);
    const link = screen.getByRole("link", { name: /notifications/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/settings/notifications");
  });

  it("marks the active item with aria-current and the soft-highlight treatment, not the outer rail's solid-pill treatment", () => {
    render(<SettingsNav active="mcp" />);
    const active = screen.getByRole("link", { name: "MCP" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.className).toContain("bg-primary/10");
    expect(active.className).not.toContain("bg-primary ");
  });

  it("every item links to its correct, real route", () => {
    render(<SettingsNav active="profile" />);
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("href", "/settings/accounts");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/settings/privacy");
    expect(screen.getByRole("link", { name: "Data & Backup" })).toHaveAttribute("href", "/settings/data-backup");
    expect(screen.getByRole("link", { name: "MCP" })).toHaveAttribute("href", "/settings/mcp");
    // Gmail link intentionally absent from nav (hidden; backend intact)
    expect(screen.queryByRole("link", { name: "Gmail" })).toBeNull();
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/settings/notifications");
  });

  it("is keyboard-navigable via Tab", async () => {
    const user = userEvent.setup();
    render(<SettingsNav active="profile" />);
    await user.tab();
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(<SettingsNav active="security" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("<SettingsShell>", () => {
  it("renders the nav alongside its children", () => {
    render(
      <SettingsShell active="mcp">
        <p>page content</p>
      </SettingsShell>,
    );
    expect(screen.getByRole("link", { name: "MCP" })).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("renders exactly one page heading (h1) -- the nav's 'Settings' label is not a competing h1", () => {
    render(
      <SettingsShell active="profile">
        <h1>Profile</h1>
      </SettingsShell>,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
