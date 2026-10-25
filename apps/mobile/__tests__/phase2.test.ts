export {};

/**
 * Gate 4 — Phase 2 feature tests.
 * Covers: sign-up validation, onboarding wizard logic, account schema,
 * privacy mode toggle, and theme preference helpers.
 * All tests run in Jest (jest-expo preset) — no native dependencies.
 */

// ── Sign-up validation helpers (mirrors sign-up.tsx logic) ───────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must contain a number.";
  return null;
}

function validateSignUp(
  email: string,
  password: string,
  confirmPassword: string,
): string | null {
  if (!isValidEmail(email)) return "Enter a valid email address.";
  const pwErr = validatePassword(password);
  if (pwErr) return pwErr;
  if (password !== confirmPassword) return "Passwords do not match.";
  return null;
}

// ── Onboarding helpers (mirrors onboarding/index.tsx logic) ───────────────────

function validateStep1(displayName: string): string | null {
  if (!displayName.trim()) return "Enter your name to continue.";
  if (displayName.trim().length > 80) return "Name is too long.";
  return null;
}

function buildCompleteOnboardingPayload(
  displayName: string,
  preferredCurrency: string,
  incomeFrequency: string | null,
  selectedCategories: string[],
  selectedGoalTypes: string[],
): Record<string, unknown> {
  return {
    displayName: displayName.trim(),
    preferredCurrency,
    ...(incomeFrequency ? { incomeFrequency } : {}),
    interestedCategories: selectedCategories,
    interestedGoalTypes: selectedGoalTypes,
  };
}

// ── Account schema helpers (mirrors accounts screen validation) ──────────────

type AccountType = "bank" | "cash" | "credit_card" | "investment";

function validateAccountForm(
  name: string,
  type: AccountType,
  currency: string,
  balanceStr: string,
  creditLimitStr?: string,
): string | null {
  if (!name.trim()) return "Account name is required.";
  if (!currency) return "Currency is required.";
  const balance = parseFloat(balanceStr);
  if (isNaN(balance)) return "Enter a valid balance.";
  if (type === "credit_card") {
    const limit = parseFloat(creditLimitStr ?? "");
    if (isNaN(limit) || limit <= 0) return "Enter a valid credit limit.";
  }
  return null;
}

// ── Privacy mode helpers (mirrors profile.tsx logic) ─────────────────────────

function maskAmount(amount: string, privacyMode: boolean): string {
  return privacyMode ? "••••" : amount;
}

// ── Theme preference helpers (mirrors theme.ts logic) ────────────────────────

type ThemePreference = "system" | "light" | "dark";
type ColorScheme = "light" | "dark" | null;

function resolveTheme(
  preference: ThemePreference,
  systemScheme: ColorScheme,
): "light" | "dark" {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemScheme === "dark" ? "dark" : "light";
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

// ── Sign-up validation ───────────────────────────────────────────────────────

describe("Sign-up validation", () => {
  describe("email validation", () => {
    test("accepts valid email", () => {
      expect(isValidEmail("user@example.com")).toBe(true);
    });
    test("rejects email without @", () => {
      expect(isValidEmail("userexample.com")).toBe(false);
    });
    test("rejects empty string", () => {
      expect(isValidEmail("")).toBe(false);
    });
    test("rejects email with spaces", () => {
      expect(isValidEmail("user @example.com")).toBe(false);
    });
  });

  describe("password validation", () => {
    test("accepts strong password", () => {
      expect(validatePassword("Abcdef1!")).toBeNull();
    });
    test("rejects password shorter than 8 chars", () => {
      expect(validatePassword("Ab1!")).toMatch(/8 characters/);
    });
    test("rejects password without uppercase", () => {
      expect(validatePassword("abcdef1!")).toMatch(/uppercase/);
    });
    test("rejects password without lowercase", () => {
      expect(validatePassword("ABCDEF1!")).toMatch(/lowercase/);
    });
    test("rejects password without digit", () => {
      expect(validatePassword("Abcdefgh!")).toMatch(/number/);
    });
  });

  describe("full sign-up form", () => {
    test("valid inputs return null error", () => {
      expect(validateSignUp("a@b.com", "Abcdef1!", "Abcdef1!")).toBeNull();
    });
    test("invalid email returns error", () => {
      expect(validateSignUp("not-email", "Abcdef1!", "Abcdef1!")).toBeTruthy();
    });
    test("weak password returns error", () => {
      expect(validateSignUp("a@b.com", "password", "password")).toBeTruthy();
    });
    test("password mismatch returns error", () => {
      expect(validateSignUp("a@b.com", "Abcdef1!", "Abcdef2!")).toMatch(/do not match/);
    });
    test("empty email returns error", () => {
      expect(validateSignUp("", "Abcdef1!", "Abcdef1!")).toBeTruthy();
    });
  });
});

// ── Onboarding wizard ────────────────────────────────────────────────────────

describe("Onboarding wizard", () => {
  describe("step 1 validation", () => {
    test("valid name passes", () => {
      expect(validateStep1("Santhosh")).toBeNull();
    });
    test("empty name fails", () => {
      expect(validateStep1("")).toMatch(/name/i);
    });
    test("whitespace-only name fails", () => {
      expect(validateStep1("   ")).toMatch(/name/i);
    });
    test("name over 80 chars fails", () => {
      expect(validateStep1("A".repeat(81))).toMatch(/too long/);
    });
    test("name exactly 80 chars passes", () => {
      expect(validateStep1("A".repeat(80))).toBeNull();
    });
  });

  describe("complete onboarding payload", () => {
    test("includes all required fields", () => {
      const payload = buildCompleteOnboardingPayload("Santhosh", "INR", null, [], []);
      expect(payload).toMatchObject({ displayName: "Santhosh", preferredCurrency: "INR" });
    });

    test("trims displayName whitespace", () => {
      const payload = buildCompleteOnboardingPayload("  Santhosh  ", "INR", null, [], []);
      expect(payload.displayName).toBe("Santhosh");
    });

    test("omits incomeFrequency when null", () => {
      const payload = buildCompleteOnboardingPayload("Test", "USD", null, [], []);
      expect(payload).not.toHaveProperty("incomeFrequency");
    });

    test("includes incomeFrequency when provided", () => {
      const payload = buildCompleteOnboardingPayload("Test", "USD", "monthly", [], []);
      expect(payload).toHaveProperty("incomeFrequency", "monthly");
    });

    test("includes empty arrays for categories and goal types when skipped", () => {
      const payload = buildCompleteOnboardingPayload("Test", "INR", null, [], []);
      expect(payload.interestedCategories).toEqual([]);
      expect(payload.interestedGoalTypes).toEqual([]);
    });

    test("includes selected categories and goal types", () => {
      const payload = buildCompleteOnboardingPayload(
        "Test", "INR", null, ["Dining", "Travel"], ["Emergency Fund"]
      );
      expect(payload.interestedCategories).toEqual(["Dining", "Travel"]);
      expect(payload.interestedGoalTypes).toEqual(["Emergency Fund"]);
    });
  });
});

// ── Account schema validation ────────────────────────────────────────────────

describe("Account form validation", () => {
  test("valid bank account passes", () => {
    expect(validateAccountForm("HDFC Savings", "bank", "INR", "50000")).toBeNull();
  });

  test("valid credit card account passes with limit", () => {
    expect(validateAccountForm("Amex Gold", "credit_card", "INR", "0", "200000")).toBeNull();
  });

  test("empty name fails", () => {
    expect(validateAccountForm("", "bank", "INR", "0")).toMatch(/name/i);
  });

  test("empty currency fails", () => {
    expect(validateAccountForm("HDFC", "bank", "", "0")).toMatch(/currency/i);
  });

  test("non-numeric balance fails", () => {
    expect(validateAccountForm("HDFC", "bank", "INR", "abc")).toMatch(/balance/i);
  });

  test("credit card without limit fails", () => {
    expect(validateAccountForm("Amex", "credit_card", "INR", "0", "")).toMatch(/limit/i);
  });

  test("credit card with zero limit fails", () => {
    expect(validateAccountForm("Amex", "credit_card", "INR", "0", "0")).toMatch(/limit/i);
  });

  test("cash account does not require credit limit", () => {
    expect(validateAccountForm("Wallet", "cash", "INR", "5000")).toBeNull();
  });

  test("investment account does not require credit limit", () => {
    expect(validateAccountForm("Zerodha", "investment", "INR", "100000")).toBeNull();
  });

  test("negative balance is valid (overdraft)", () => {
    expect(validateAccountForm("Current", "bank", "INR", "-5000")).toBeNull();
  });
});

// ── Privacy mode ─────────────────────────────────────────────────────────────

describe("Privacy mode masking", () => {
  test("shows amount when privacy mode is off", () => {
    expect(maskAmount("₹1,234", false)).toBe("₹1,234");
  });

  test("masks amount when privacy mode is on", () => {
    expect(maskAmount("₹1,234", true)).toBe("••••");
  });

  test("masks zero balance when privacy mode is on", () => {
    expect(maskAmount("₹0", true)).toBe("••••");
  });

  test("masks large amounts when privacy mode is on", () => {
    expect(maskAmount("₹1,00,000", true)).toBe("••••");
  });

  test("masking is consistent for all values", () => {
    const amounts = ["₹0", "₹100", "₹1,000", "-₹500", "₹10,00,000"];
    amounts.forEach((amount) => {
      expect(maskAmount(amount, true)).toBe("••••");
      expect(maskAmount(amount, false)).toBe(amount);
    });
  });
});

// ── Theme preference ──────────────────────────────────────────────────────────

describe("Theme preference resolution", () => {
  test("explicit 'light' preference always returns light", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("light", "light")).toBe("light");
    expect(resolveTheme("light", null)).toBe("light");
  });

  test("explicit 'dark' preference always returns dark", () => {
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("dark", "dark")).toBe("dark");
    expect(resolveTheme("dark", null)).toBe("dark");
  });

  test("'system' defers to system scheme when dark", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
  });

  test("'system' defers to system scheme when light", () => {
    expect(resolveTheme("system", "light")).toBe("light");
  });

  test("'system' with no scheme defaults to light", () => {
    expect(resolveTheme("system", null)).toBe("light");
  });
});

// ── Onboarding chip toggle logic ──────────────────────────────────────────────

describe("Chip toggle logic (onboarding step 3)", () => {
  function toggle(current: string[], item: string): string[] {
    return current.includes(item)
      ? current.filter((c) => c !== item)
      : [...current, item];
  }

  test("adds item when not selected", () => {
    expect(toggle([], "Dining")).toEqual(["Dining"]);
  });

  test("removes item when already selected", () => {
    expect(toggle(["Dining", "Travel"], "Dining")).toEqual(["Travel"]);
  });

  test("supports multiple selections", () => {
    let state: string[] = [];
    state = toggle(state, "Dining");
    state = toggle(state, "Travel");
    state = toggle(state, "Healthcare");
    expect(state).toEqual(["Dining", "Travel", "Healthcare"]);
  });

  test("deselecting all results in empty array", () => {
    let state = ["Dining"];
    state = toggle(state, "Dining");
    expect(state).toEqual([]);
  });
});
