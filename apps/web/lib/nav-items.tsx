import { Home as HomeIcon, Sparkles, ArrowLeftRight, MapPinned, Target, Settings as SettingsIcon, Car } from "lucide-react";
import type { NavigationRailItem } from "@/components/spencare/navigation-rail";

/**
 * Canonical primary nav: Home · AI · Cash Flow · Plans · Goals · Settings.
 * Imported by every page that renders a NavigationRail so the set is never
 * duplicated or out of sync. `isNavItemActive` in lib/navigation.ts derives
 * the active state from the current pathname automatically -- no page needs
 * to hardcode it.
 *
 * Gate 4 (Plans): added between Cash Flow and Goals, matching the product
 * spec's relative ordering intent -- Plans is real-life-purpose context
 * over the same transactions Cash Flow already shows, so it sits logically
 * next to it, ahead of the two single-purpose savings/limit destinations
 * (Goals, and Budgets/Accounts which remain nested under Cash Flow/
 * Settings respectively and are not promoted to top-level nav by this
 * gate -- only Plans was asked for).
 */
export const PRIMARY_NAV_ITEMS: NavigationRailItem[] = [
  { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
  { key: "spensa", label: "Spensa AI", icon: <Sparkles className="size-5" />, href: "/spensa/new" },
  { key: "cash-flow", label: "Cash Flow", icon: <ArrowLeftRight className="size-5" />, href: "/cash-flow" },
  { key: "plans", label: "Plans", icon: <MapPinned className="size-5" />, href: "/plans" },
  { key: "goals", label: "Goals", icon: <Target className="size-5" />, href: "/goals" },
  { key: "vehicles", label: "Vehicles", icon: <Car className="size-5" />, href: "/vehicles" },
  { key: "settings", label: "Settings", icon: <SettingsIcon className="size-5" />, href: "/settings/profile" },
];
