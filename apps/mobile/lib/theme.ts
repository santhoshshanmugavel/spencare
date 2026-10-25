/**
 * Spencare mobile design tokens.
 *
 * Source of truth: apps/web/app/globals.css
 * Primary violet: --primary: oklch(0.55 0.24 296) ≈ #7C3AED (light)
 *                            oklch(0.72 0.18 296) ≈ #A78BFA (dark)
 *
 * OKLCH → hex conversions were verified against the globals.css comment
 * "violet accent (#7C3AED)" and the Tailwind oklch palette.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

const THEME_PREF_KEY = "spencare.theme_preference";

// ─────────────────────────────────────────────────────────────────────────────
// Token palettes
// ─────────────────────────────────────────────────────────────────────────────

export const lightTokens = {
  // Surfaces
  background: "#FFFFFF", // oklch(1 0 0)
  backgroundSubtle: "#F7F7F7", // oklch(0.97 0 0) — muted
  card: "#FFFFFF", // oklch(1 0 0)
  surfaceElevated: "#FFFFFF", // oklch(1 0 0)
  surfaceOverlay: "#FAFAFA", // oklch(0.98 0 0)

  // Text
  foreground: "#2A2A2A", // oklch(0.17 0 0)
  foregroundMuted: "#737373", // oklch(0.5 0 0)
  foregroundSubtle: "#9E9E9E", // oklch(0.62 0 0) — placeholder, tertiary

  // Brand — Spencare violet
  primary: "#7C3AED", // oklch(0.55 0.24 296) ← verified against web globals.css
  primaryForeground: "#FFFFFF",
  primarySubtle: "#F5F0FF", // oklch(0.96 0.015 296) — tinted bg

  // Semantic
  destructive: "#DC2626", // oklch(0.58 0.22 27)
  destructiveFg: "#FFFFFF",
  destructiveSubtle: "#FEF2F2",
  destructiveBorder: "#FECACA",

  income: "#16A34A", // oklch(0.52 0.14 155)
  incomeFg: "#FFFFFF",
  incomeSubtle: "#F0FDF4", // oklch(0.95 0.04 155)

  expense: "#C2410C", // oklch(0.55 0.2 27)
  expenseFg: "#FFFFFF",
  expenseSubtle: "#FFF7ED", // oklch(0.96 0.04 27)

  warning: "#B45309", // oklch(0.64 0.14 75)
  warningFg: "#FFFFFF",
  warningSubtle: "#FFFBEB",

  // Structure
  border: "#E5E5E5", // oklch(0.9 0 0)
  separator: "#F1F5F9", // row dividers — slightly blue-grey

  // Tab bar
  tabBarBackground: "#FFFFFF",
  tabBarBorder: "#E2E8F0",
  tabBarActive: "#7C3AED", // primary violet — was incorrectly #6366f1
  tabBarInactive: "#94A3B8",
} as const;

export const darkTokens: Theme = {
  // Surfaces
  background: "#1F1F1F", // oklch(0.13 0 0)
  backgroundSubtle: "#383838", // oklch(0.22 0 0)
  card: "#2B2B2B", // oklch(0.17 0 0)
  surfaceElevated: "#303030", // oklch(0.19 0 0)
  surfaceOverlay: "#353535", // oklch(0.21 0 0)

  // Text
  foreground: "#F2F2F2", // oklch(0.95 0 0)
  foregroundMuted: "#9E9E9E", // oklch(0.62 0 0)
  foregroundSubtle: "#737373", // oklch(0.5 0 0)

  // Brand
  primary: "#A78BFA", // oklch(0.72 0.18 296) — lighter violet for dark bg
  primaryForeground: "#1F1040", // oklch(0.12 0.02 296)
  primarySubtle: "#3A2960", // oklch(0.23 0.04 296)

  // Semantic
  destructive: "#F87171", // oklch(0.68 0.2 22.2)
  destructiveFg: "#1F1040",
  destructiveSubtle: "#1F0A0A",
  destructiveBorder: "#7F1D1D",

  income: "#4ADE80", // oklch(0.65 0.16 155)
  incomeFg: "#052E16",
  incomeSubtle: "#052E16", // oklch(0.22 0.05 155)

  expense: "#FB923C", // oklch(0.68 0.2 22.2)
  expenseFg: "#1C0A00",
  expenseSubtle: "#1C0A00",

  warning: "#FBBF24", // oklch(0.78 0.16 75)
  warningFg: "#1C1107",
  warningSubtle: "#1C1107",

  // Structure
  border: "rgba(255,255,255,0.10)", // oklch(1 0 0 / 10%)
  separator: "rgba(255,255,255,0.06)",

  // Tab bar
  tabBarBackground: "#1F1F1F",
  tabBarBorder: "rgba(255,255,255,0.10)",
  tabBarActive: "#A78BFA",
  tabBarInactive: "#737373",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Scale constants — not theme-dependent
// ─────────────────────────────────────────────────────────────────────────────

/** Border-radius scale (points). Mirrors web --radius-* tokens. */
export const radius = {
  sm: 4, // 4px  — tags, badges     (web --radius-sm: 0.25rem)
  md: 8, // 8px  — buttons, inputs  (web --radius-md: 0.5rem)
  lg: 14, // 14px — cards, panels    (web --radius-lg: 0.875rem)
  xl: 20, // 20px — sheets           (web --radius-xl: 1.25rem)
  pill: 9999,
} as const;

/** Spacing scale (points). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Typography scale. */
export const typography = {
  size: {
    xs: 11,
    sm: 12,
    base: 14,
    md: 15,
    lg: 16,
    xl: 18,
    "2xl": 22,
    "3xl": 26,
    "4xl": 32,
    "5xl": 36,
  },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
    extrabold: "800" as const,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Theme preference context + hook
// ─────────────────────────────────────────────────────────────────────────────

/** All token values as strings, same key shape as lightTokens. */
export type Theme = { [K in keyof typeof lightTokens]: string };

/** Explicit preference stored in SecureStore. "system" defers to the OS. */
export type ThemePreference = "system" | "light" | "dark";

interface ThemePreferenceContextValue {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => Promise<void>;
  /** Resolved tokens for the current effective scheme. */
  t: Theme;
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue>({
  preference: "system",
  setPreference: async () => {},
  t: lightTokens,
});

export function ThemePreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const osScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    SecureStore.getItemAsync(THEME_PREF_KEY)
      .then((stored) => {
        if (stored === "light" || stored === "dark" || stored === "system") {
          setPreferenceState(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setPreference = useCallback(async (pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      await SecureStore.setItemAsync(THEME_PREF_KEY, pref);
    } catch {}
  }, []);

  const effectiveScheme =
    preference === "system" ? (osScheme ?? "light") : preference;
  const t = effectiveScheme === "dark" ? darkTokens : lightTokens;

  return React.createElement(
    ThemePreferenceContext.Provider,
    { value: { preference, setPreference, t } },
    children,
  );
}

export function useThemePreference(): ThemePreferenceContextValue {
  return useContext(ThemePreferenceContext);
}

/**
 * Returns the correct color palette for the effective color scheme.
 * Respects the user's explicit preference when inside ThemePreferenceProvider;
 * falls back to the OS scheme otherwise. The returned object is stable
 * (one of the two module-level constants), safe as a useMemo dependency.
 */
export function useTheme(): Theme {
  const ctx = useContext(ThemePreferenceContext);
  const osScheme = useColorScheme(); // always called — no conditional hook

  if (ctx.preference !== "system") {
    return ctx.t;
  }
  return osScheme === "dark" ? darkTokens : lightTokens;
}
