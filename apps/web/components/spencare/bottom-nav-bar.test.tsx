import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomNavBar } from "./bottom-nav-bar";
import type { NavigationRailItem } from "./navigation-rail";
import { Home as HomeIcon } from "lucide-react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
}));

const items: NavigationRailItem[] = [
  { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
  { key: "cash-flow", label: "Cash Flow", icon: <HomeIcon className="size-5" />, href: "/cash-flow" },
  { key: "settings", label: "Settings", icon: <HomeIcon className="size-5" />, href: "/settings/profile" },
];

describe("<BottomNavBar>", () => {
  it("renders one link per item with its label as the accessible name", () => {
    render(<BottomNavBar items={items} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: "Cash Flow" })).toHaveAttribute("href", "/cash-flow");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/profile");
  });

  it("marks the item matching the current pathname as aria-current='page'", () => {
    render(<BottomNavBar items={items} />);
    const home = screen.getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("aria-current", "page");
    const cashFlow = screen.getByRole("link", { name: "Cash Flow" });
    expect(cashFlow).not.toHaveAttribute("aria-current");
  });

  it("hides at md and up via a utility class so the left rail is the sole nav on desktop (regression guard)", () => {
    const { container } = render(<BottomNavBar items={items} />);
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("md:hidden");
  });

  it("renders with safe-area bottom padding so iPhone home-indicator does not cover the row", () => {
    const { container } = render(<BottomNavBar items={items} />);
    const nav = container.querySelector("nav");
    // The class literal references env(safe-area-inset-bottom); checking
    // the substring is enough to catch an accidental removal.
    expect(nav?.className).toContain("safe-area-inset-bottom");
  });
});
