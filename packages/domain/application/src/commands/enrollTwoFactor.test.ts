import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

// In-memory fake for the two sensitive-column repo functions -- exercises
// the REAL crypto (encryptSecret/decryptSecret) and REAL TOTP/backup-code
// logic from domain-core; only the Supabase-touching persistence is faked.
let store: {
  totp_secret_encrypted: Buffer | null;
  backup_codes_hash: string[];
  two_factor_enabled: boolean;
};

vi.mock("@spencare/domain-infra", async () => {
  const actual = await vi.importActual<typeof import("@spencare/domain-infra")>(
    "@spencare/domain-infra",
  );
  return {
    ...actual,
    storePendingTotpSecret: vi.fn(async (_c: unknown, _u: string, encrypted: Buffer) => {
      store.totp_secret_encrypted = encrypted;
    }),
    getEncryptedTotpSecret: vi.fn(async () => store.totp_secret_encrypted),
    enableTwoFactorWithBackupCodes: vi.fn(async (_c: unknown, _u: string, hashes: string[]) => {
      store.two_factor_enabled = true;
      store.backup_codes_hash = hashes;
    }),
    getBackupCodeHashes: vi.fn(async () => store.backup_codes_hash),
    setBackupCodeHashes: vi.fn(async (_c: unknown, _u: string, hashes: string[]) => {
      store.backup_codes_hash = hashes;
    }),
  };
});

const { startTotpEnrollment, confirmTotpEnrollment, verifyTwoFactorChallenge } = await import(
  "./enrollTwoFactor.js"
);

function makeCtx(): AuthContext {
  return {
    userId: "user-a",
    email: "user@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

beforeEach(() => {
  store = { totp_secret_encrypted: null, backup_codes_hash: [], two_factor_enabled: false };
  process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString("hex");
});

describe("startTotpEnrollment", () => {
  it("stores the secret ENCRYPTED, not plaintext, while returning the plaintext once for the QR/manual entry", async () => {
    const result = await startTotpEnrollment.execute(makeCtx(), {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.secretBase32.length).toBeGreaterThan(0);
    expect(store.totp_secret_encrypted).not.toBeNull();
    // The persisted bytes never contain the plaintext secret.
    expect(store.totp_secret_encrypted!.toString("base64")).not.toContain(
      result.value.secretBase32,
    );
  });

  it("does not enable 2FA yet -- enrollment is pending until confirmed", async () => {
    await startTotpEnrollment.execute(makeCtx(), {});
    expect(store.two_factor_enabled).toBe(false);
  });
});

describe("confirmTotpEnrollment", () => {
  it("rejects a malformed code before touching the stored secret", async () => {
    const result = await confirmTotpEnrollment.execute(makeCtx(), { code: "abc" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("rejects when there's no pending enrollment", async () => {
    const result = await confirmTotpEnrollment.execute(makeCtx(), { code: "123456" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("no_pending_enrollment");
  });

  it("rejects an incorrect code and leaves 2FA disabled", async () => {
    await startTotpEnrollment.execute(makeCtx(), {});
    const result = await confirmTotpEnrollment.execute(makeCtx(), { code: "000000" });
    expect(result.ok).toBe(false);
    expect(store.two_factor_enabled).toBe(false);
  });

  it("enables 2FA and returns 10 backup codes on a correct code", async () => {
    const enroll = await startTotpEnrollment.execute(makeCtx(), {});
    if (!enroll.ok) throw new Error("setup failed");
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(enroll.value.secretBase32),
    });
    const result = await confirmTotpEnrollment.execute(makeCtx(), { code: totp.generate() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.backupCodes).toHaveLength(10);
    expect(store.two_factor_enabled).toBe(true);
    expect(store.backup_codes_hash).toHaveLength(10);
    // Only hashes are persisted -- none of the returned plaintext codes appear in storage.
    if (result.ok) {
      for (const code of result.value.backupCodes) {
        expect(store.backup_codes_hash).not.toContain(code);
      }
    }
  });
});

describe("verifyTwoFactorChallenge", () => {
  async function enrollAndConfirm() {
    const enroll = await startTotpEnrollment.execute(makeCtx(), {});
    if (!enroll.ok) throw new Error("setup failed");
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(enroll.value.secretBase32),
    });
    const confirm = await confirmTotpEnrollment.execute(makeCtx(), { code: totp.generate() });
    if (!confirm.ok) throw new Error("confirm failed");
    return { secretBase32: enroll.value.secretBase32, backupCodes: confirm.value.backupCodes };
  }

  it("accepts a valid current TOTP code", async () => {
    const { secretBase32 } = await enrollAndConfirm();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const result = await verifyTwoFactorChallenge.execute(makeCtx(), { code: totp.generate() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.method).toBe("totp");
  });

  it("accepts a valid backup code and consumes it (single-use)", async () => {
    const { backupCodes } = await enrollAndConfirm();
    const first = await verifyTwoFactorChallenge.execute(makeCtx(), { code: backupCodes[0]! });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.method).toBe("backup_code");

    // Same code again must fail -- it was removed from the stored set.
    const second = await verifyTwoFactorChallenge.execute(makeCtx(), { code: backupCodes[0]! });
    expect(second.ok).toBe(false);
  });

  it("rejects a code that is neither a valid TOTP code nor a known backup code", async () => {
    await enrollAndConfirm();
    const result = await verifyTwoFactorChallenge.execute(makeCtx(), { code: "999999" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_2fa_code");
  });
});
