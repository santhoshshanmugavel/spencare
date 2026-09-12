import { Home as HomeIcon, Sparkles, ArrowLeftRight, Target, Settings as SettingsIcon } from "lucide-react";
import type { NavigationRailItem } from "@/components/spencare/navigation-rail";

/**
 * Canonical 5-item primary nav: Home · AI · Cash Flow · Goals · Settings.
 * Imported by every page that renders a NavigationRail so the set is never
 * duplicated or out of sync. `isNavItemActive` in lib/navigation.ts derives
 * the active state from the current pathname automatically -- no page needs
 * to hardcode it.
 */
export const PRIMARY_NAV_ITEMS: NavigationRailItem[] = [
  { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
  { key: "spensa", label: "Spensa AI", icon: <Sparkles className="size-5" />, href: "/spensa/new" },
  { key: "cash-flow", label: "Cash Flow", icon: <ArrowLeftRight className="size-5" />, href: "/cash-flow" },
  { key: "goals", label: "Goals", icon: <Target className="size-5" />, href: "/goals" },
  { key: "settings", label: "Settings", icon: <SettingsIcon className="size-5" />, href: "/settings/profile" },
];
