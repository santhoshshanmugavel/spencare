import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationRail, type NavigationRailItem } from "./navigation-rail";
import { TooltipProvider } from "@/components/ui/tooltip";

// Phase 28 Part 1: NavigationRail now derives `active` from usePathname()
// (see lib/navigation.ts) rather than trusting a hardcoded prop for items
// that don't set an explicit override -- mocked here the same way any
// real page's current route would be, with a mutable current path so
// individual tests can exercise different routes.
let currentPath = "/home";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

const items: NavigationRailItem[] = [
  { key: "home", label: "Spensa", icon: <span>✦</span>, href: "/home" },
  { key: "cash-flow", label: "Cash Flow", icon: <span>$</span>, href: "/cash-flow" },
  { key: "goals", label: "Goals", icon: <span>◎</span>, href: "/goals" },
  { key: "settings", label: "Settings", icon: <span>⚙</span>, href: "/settings" },
];

type NavigationRailOverrides = Partial<
  Omit<React.ComponentProps<typeof NavigationRail>, "brand" | "items">
>;

function renderRail(props: NavigationRailOverrides = {}) {
  return render(
    <TooltipProvider>
      <NavigationRail brand={<span>S</span>} items={items} {...props} />
    </TooltipProvider>,
  );
}

describe("<NavigationRail>", () => {
  beforeEach(() => {
    currentPath = "/home";
  });

  it('is a labeled <nav role="navigation">', () => {
    renderRail();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("renders all 4 confirmed destinations in order", () => {
    renderRail();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAccessibleName("Spensa");
    expect(links[3]).toHaveAccessibleName("Settings");
  });

  it("marks the active item with aria-current=page, derived from the current pathname", () => {
    currentPath = "/home";
    renderRail();
    expect(screen.getByRole("link", { name: "Spensa" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Goals" })).not.toHaveAttribute("aria-current");
  });

  it("Phase 28 Part 1: activates the correct item on a nested route, with no hardcoded active prop anywhere", () => {
    currentPath = "/cash-flow/transactions";
    renderRail();
    expect(screen.getByRole("link", { name: "Cash Flow" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Spensa" })).not.toHaveAttribute("aria-current");
  });

  it("an explicit `active` prop still overrides pathname derivation when a caller sets one", () => {
    currentPath = "/goals";
    render(
      <TooltipProvider>
        <NavigationRail
          brand={<span>S</span>}
          items={[{ key: "home", label: "Spensa", icon: <span>✦</span>, href: "/home", active: true }]}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("link", { name: "Spensa" })).toHaveAttribute("aria-current", "page");
  });

  it("calls onNavigate instead of a real navigation when provided", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderRail({ onNavigate });
    await user.click(screen.getByRole("link", { name: "Cash Flow" }));
    expect(onNavigate).toHaveBeenCalledWith(items[1]);
  });
});
