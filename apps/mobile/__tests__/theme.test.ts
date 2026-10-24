import { lightTokens, darkTokens, radius, spacing, typography } from "../lib/theme";

// ── Token shape verification ─────────────────────────────────────────────────

const REQUIRED_KEYS: (keyof typeof lightTokens)[] = [
  "background",
  "backgroundSubtle",
  "card",
  "surfaceElevated",
  "surfaceOverlay",
  "foreground",
  "foregroundMuted",
  "foregroundSubtle",
  "primary",
  "primaryForeground",
  "primarySubtle",
  "destructive",
  "destructiveFg",
  "destructiveSubtle",
  "destructiveBorder",
  "income",
  "incomeFg",
  "incomeSubtle",
  "expense",
  "expenseFg",
  "expenseSubtle",
  "warning",
  "warningFg",
  "warningSubtle",
  "border",
  "separator",
  "tabBarBackground",
  "tabBarBorder",
  "tabBarActive",
  "tabBarInactive",
];

describe("lightTokens", () => {
  test("primary is the verified Spencare brand violet #7C3AED", () => {
    expect(lightTokens.primary).toBe("#7C3AED");
  });

  test("tabBarActive matches primary (violet, not indigo)", () => {
    expect(lightTokens.tabBarActive).toBe("#7C3AED");
  });

  test("all required token keys are present", () => {
    for (const key of REQUIRED_KEYS) {
      expect(lightTokens).toHaveProperty(key);
      expect(typeof lightTokens[key]).toBe("string");
      expect(lightTokens[key].length).toBeGreaterThan(0);
    }
  });

  test("no legacy indigo color #6366f1 used (was the wrong primary)", () => {
    const values = Object.values(lightTokens);
    expect(values).not.toContain("#6366f1");
  });
});

describe("darkTokens", () => {
  test("dark primary is the verified accessible violet #A78BFA", () => {
    expect(darkTokens.primary).toBe("#A78BFA");
  });

  test("dark tabBarActive matches dark primary", () => {
    expect(darkTokens.tabBarActive).toBe("#A78BFA");
  });

  test("all required token keys are present in dark palette", () => {
    for (const key of REQUIRED_KEYS) {
      expect(darkTokens).toHaveProperty(key);
      expect(typeof darkTokens[key]).toBe("string");
      expect(darkTokens[key].length).toBeGreaterThan(0);
    }
  });

  test("dark and light palettes have identical key sets", () => {
    const lightKeys = Object.keys(lightTokens).sort();
    const darkKeys = Object.keys(darkTokens).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  test("no legacy indigo color #6366f1 used", () => {
    const values = Object.values(darkTokens);
    expect(values).not.toContain("#6366f1");
  });
});

describe("radius tokens", () => {
  test("sm is 4 (matches web --radius-sm)", () => expect(radius.sm).toBe(4));
  test("md is 8 (matches web --radius-md)", () => expect(radius.md).toBe(8));
  test("lg is 14 (matches web --radius-lg base radius)", () => expect(radius.lg).toBe(14));
  test("xl is 20 (matches web --radius-xl)", () => expect(radius.xl).toBe(20));
  test("pill is 9999", () => expect(radius.pill).toBe(9999));

  test("scale is ordered sm < md < lg < xl < pill", () => {
    expect(radius.sm).toBeLessThan(radius.md);
    expect(radius.md).toBeLessThan(radius.lg);
    expect(radius.lg).toBeLessThan(radius.xl);
    expect(radius.xl).toBeLessThan(radius.pill);
  });
});

describe("spacing tokens", () => {
  test("all values are positive integers", () => {
    for (const [key, val] of Object.entries(spacing)) {
      expect(typeof val).toBe("number");
      expect(val).toBeGreaterThan(0);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  test("scale is ordered xs < sm < md < lg < xl < xxl", () => {
    expect(spacing.xs).toBeLessThan(spacing.sm);
    expect(spacing.sm).toBeLessThan(spacing.md);
    expect(spacing.md).toBeLessThan(spacing.lg);
    expect(spacing.lg).toBeLessThan(spacing.xl);
    expect(spacing.xl).toBeLessThan(spacing.xxl);
  });
});

describe("typography tokens", () => {
  test("size scale contains expected keys", () => {
    const expected = ["xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
    for (const key of expected) {
      expect(typography.size).toHaveProperty(key);
      expect(typeof typography.size[key as keyof typeof typography.size]).toBe("number");
    }
  });

  test("weight values are valid CSS font-weight strings", () => {
    const valid = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
    for (const [key, val] of Object.entries(typography.weight)) {
      expect(valid).toContain(val);
    }
  });
});

describe("useTheme hook (indirect via tokens)", () => {
  test("lightTokens contains primary key with string value", () => {
    expect(lightTokens).toHaveProperty("primary");
    expect(typeof lightTokens.primary).toBe("string");
  });

  test("lightTokens contains all required keys", () => {
    for (const key of REQUIRED_KEYS) {
      expect(lightTokens).toHaveProperty(key);
    }
  });
});
