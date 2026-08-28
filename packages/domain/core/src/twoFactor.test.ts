import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";
import {
  consumeBackupCode,
  generateBackupCodes,
  generateTotpEnrollment,
  hashBackupCode,
  verifyTotpCode,
} from "./twoFactor.js";

describe("generateTotpEnrollment", () => {
  it("produces a base32 secret and a matching otpauth:// URI", () => {
    const enrollment = generateTotpEnrollment("user@example.com");
    expect(enrollment.secretBase32.length).toBeGreaterThan(0);
    expect(enrollment.otpAuthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.otpAuthUri).toContain("Spencare");
  });

  it("generates a different secret on every call (uses a CSPRNG, not a fixed value)", () => {
    const a = generateTotpEnrollment("a@example.com");
    const b = generateTotpEnrollment("b@example.com");
    expect(a.secretBase32).not.toBe(b.secretBase32);
  });
});

describe("verifyTotpCode", () => {
  it("accepts the currently-valid code for a secret", () => {
    const { secretBase32 } = generateTotpEnrollment("user@example.com");
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const validCode = totp.generate();
    expect(verifyTotpCode(secretBase32, validCode)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const { secretBase32 } = generateTotpEnrollment("user@example.com");
    expect(verifyTotpCode(secretBase32, "000000")).toBe(false);
  });

  it("rejects a code generated from a different secret", () => {
    const a = generateTotpEnrollment("a@example.com");
    const b = generateTotpEnrollment("b@example.com");
    const totpB = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(b.secretBase32),
    });
    expect(verifyTotpCode(a.secretBase32, totpB.generate())).toBe(false);
  });
});

describe("generateBackupCodes", () => {
  it("generates 10 codes by default, each in XXXX-XXXX form", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it("never repeats a code within one generated set", () => {
    const codes = generateBackupCodes();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("excludes visually ambiguous characters (0/O/1/I)", () => {
    const codes = generateBackupCodes(50);
    const joined = codes.join("");
    expect(joined).not.toMatch(/[01OI]/);
  });
});

describe("hashBackupCode / consumeBackupCode — single-use contract", () => {
  it("hashes never equal the plaintext code", () => {
    const code = "AB12-CD34";
    expect(hashBackupCode(code)).not.toBe(code);
  });

  it("matches the correct code case-insensitively and removes it from the returned set", () => {
    const codes = generateBackupCodes(3);
    const hashes = codes.map(hashBackupCode);
    const result = consumeBackupCode(codes[0]!.toLowerCase(), hashes);
    expect(result.matched).toBe(true);
    expect(result.remainingHashes).toHaveLength(2);
    expect(result.remainingHashes).not.toContain(hashes[0]);
  });

  it("does not match a code that was never issued, and leaves all hashes intact", () => {
    const codes = generateBackupCodes(3);
    const hashes = codes.map(hashBackupCode);
    const result = consumeBackupCode("ZZZZ-ZZZZ", hashes);
    expect(result.matched).toBe(false);
    expect(result.remainingHashes).toHaveLength(3);
  });

  it("a code cannot be consumed twice -- the second attempt against the caller's persisted remaining set fails", () => {
    const codes = generateBackupCodes(3);
    let hashes = codes.map(hashBackupCode);

    const first = consumeBackupCode(codes[0]!, hashes);
    expect(first.matched).toBe(true);
    hashes = first.remainingHashes; // caller persists this back, per the documented contract

    const second = consumeBackupCode(codes[0]!, hashes);
    expect(second.matched).toBe(false);
  });
});
