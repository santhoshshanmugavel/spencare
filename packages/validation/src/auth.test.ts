import { describe, expect, it } from "vitest";
import {
  backupCodeSchema,
  emailSchema,
  forgotPasswordSchema,
  passwordSchema,
  profileUpdateSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  totpVerifySchema,
} from "./auth.js";

describe("passwordSchema", () => {
  it("accepts a compliant password", () => {
    expect(passwordSchema.safeParse("Abcdef12").success).toBe(true);
  });

  it("rejects a too-short password", () => {
    expect(passwordSchema.safeParse("Ab1").success).toBe(false);
  });

  it("rejects a password with no digit", () => {
    expect(passwordSchema.safeParse("Abcdefgh").success).toBe(false);
  });

  it("rejects a password with no uppercase letter", () => {
    expect(passwordSchema.safeParse("abcdefg1").success).toBe(false);
  });

  it("rejects a password with no lowercase letter", () => {
    expect(passwordSchema.safeParse("ABCDEFG1").success).toBe(false);
  });
});

describe("emailSchema", () => {
  it("normalizes to lowercase and trims", () => {
    const result = emailSchema.safeParse("  Test@Example.com  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("test@example.com");
  });

  it("rejects a malformed address", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("signUpSchema / signInSchema", () => {
  it("signUpSchema enforces the full password policy", () => {
    expect(signUpSchema.safeParse({ email: "a@b.com", password: "weak" }).success).toBe(false);
    expect(signUpSchema.safeParse({ email: "a@b.com", password: "Strong123" }).success).toBe(true);
  });

  it("signInSchema only requires presence, not complexity (existing accounts may predate the policy)", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("requires a valid email only", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts matching, compliant passwords", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "Strong123", confirmPassword: "Strong123" })
        .success,
    ).toBe(true);
  });

  it("rejects mismatched passwords, attributed to confirmPassword", () => {
    const result = resetPasswordSchema.safeParse({
      password: "Strong123",
      confirmPassword: "Different1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });
});

describe("profileUpdateSchema", () => {
  it("accepts a valid update", () => {
    expect(
      profileUpdateSchema.safeParse({
        displayName: "Santhosh",
        preferredCurrency: "INR",
        timezone: "Asia/Kolkata",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-3-letter currency code", () => {
    expect(
      profileUpdateSchema.safeParse({ preferredCurrency: "Rupee", timezone: "Asia/Kolkata" })
        .success,
    ).toBe(false);
  });

  it("rejects an unrecognized timezone", () => {
    expect(
      profileUpdateSchema.safeParse({ preferredCurrency: "INR", timezone: "Mars/Olympus_Mons" })
        .success,
    ).toBe(false);
  });
});

describe("totpVerifySchema", () => {
  it("accepts a 6-digit code", () => {
    expect(totpVerifySchema.safeParse({ code: "123456" }).success).toBe(true);
  });

  it("rejects a non-6-digit code", () => {
    expect(totpVerifySchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(totpVerifySchema.safeParse({ code: "abcdef" }).success).toBe(false);
  });
});

describe("backupCodeSchema", () => {
  it("accepts and uppercases the XXXX-XXXX format", () => {
    const result = backupCodeSchema.safeParse({ code: "ab12-cd34" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("AB12-CD34");
  });

  it("rejects the wrong shape", () => {
    expect(backupCodeSchema.safeParse({ code: "AB12CD34" }).success).toBe(false);
  });
});
