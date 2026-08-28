import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, MissingEncryptionKeyError } from "./crypto.js";

const TEST_KEY = randomBytes(32).toString("hex");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret exactly", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(secret, TEST_KEY);
    expect(decryptSecret(encrypted, TEST_KEY)).toBe(secret);
  });

  it("never stores the plaintext inside the encrypted buffer", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(secret, TEST_KEY);
    expect(encrypted.toString("utf8")).not.toContain(secret);
    expect(encrypted.toString("base64")).not.toContain(secret);
  });

  it("produces a different ciphertext for the same plaintext on every call (random IV)", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const a = encryptSecret(secret, TEST_KEY);
    const b = encryptSecret(secret, TEST_KEY);
    expect(a.equals(b)).toBe(false);
    // ...but both still decrypt to the same plaintext.
    expect(decryptSecret(a, TEST_KEY)).toBe(secret);
    expect(decryptSecret(b, TEST_KEY)).toBe(secret);
  });

  it("fails to decrypt with the wrong key (authenticated encryption catches tampering/wrong key)", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(secret, TEST_KEY);
    const wrongKey = randomBytes(32).toString("hex");
    expect(() => decryptSecret(encrypted, wrongKey)).toThrow();
  });

  it("fails to decrypt a tampered ciphertext", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(secret, TEST_KEY);
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptSecret(tampered, TEST_KEY)).toThrow();
  });

  it("throws a clear, typed error when the encryption key is missing rather than silently proceeding", () => {
    expect(() => encryptSecret("secret", undefined)).toThrow(MissingEncryptionKeyError);
  });

  it("rejects a key that isn't a 32-byte hex value", () => {
    expect(() => encryptSecret("secret", "too-short")).toThrow();
  });
});
