import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

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
    disableTwoFactor: vi.fn(async () => {
      store.two_factor_enabled = false;
      store.totp_secret_encrypted = null;
      store.backup_codes_hash = [];
    }),
  };
});

const { startTotpEnrollment, confirmTotpEnrollment, verifyTwoFactorChallenge } = await import(
  "./enrollTwoFactor.js"
);
const { disableTwoFactor, regenerateBackupCodes } = await import("./disableTwoFactor.js");

function makeCtx(): AuthContext {
  return {
    userId: "user-a",
    email: "user@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

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

beforeEach(() => {
  store = { totp_secret_encrypted: null, backup_codes_hash: [], two_factor_enabled: false };
  process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString("hex");
});

describe("disableTwoFactor — re-verification gate", () => {
  it("refuses to disable without a valid current code", async () => {
    await enrollAndConfirm();
    const result = await disableTwoFactor.execute(makeCtx(), { code: "000000" });
    expect(result.ok).toBe(false);
    expect(store.two_factor_enabled).toBe(true); // untouched -- gate held
  });

  it("disables only after a valid code is supplied", async () => {
    const { secretBase32 } = await enrollAndConfirm();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const result = await disableTwoFactor.execute(makeCtx(), { code: totp.generate() });
    expect(result.ok).toBe(true);
    expect(store.two_factor_enabled).toBe(false);
    expect(store.totp_secret_encrypted).toBeNull();
    expect(store.backup_codes_hash).toEqual([]);
  });
});

describe("regenerateBackupCodes — re-verification gate", () => {
  it("refuses without a valid current code, leaving the old codes intact", async () => {
    const { backupCodes } = await enrollAndConfirm();
    const result = await regenerateBackupCodes.execute(makeCtx(), { code: "000000" });
    expect(result.ok).toBe(false);
    expect(store.backup_codes_hash).toHaveLength(backupCodes.length);
  });

  it("issues a fresh set of 10 codes and invalidates the old ones after valid re-verification", async () => {
    const { secretBase32, backupCodes: oldCodes } = await enrollAndConfirm();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const result = await regenerateBackupCodes.execute(makeCtx(), { code: totp.generate() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.backupCodes).toHaveLength(10);
    expect(result.value.backupCodes).not.toEqual(oldCodes);
    expect(store.backup_codes_hash).toHaveLength(10);

    // The security property that actually matters: not just that the
    // stored hashes differ, but that none of the OLD plaintext codes can
    // still authenticate, and every NEW code can.
    for (const oldCode of oldCodes) {
      const attempt = await verifyTwoFactorChallenge.execute(makeCtx(), { code: oldCode });
      expect(attempt.ok).toBe(false);
    }
    for (const newCode of result.value.backupCodes) {
      const attempt = await verifyTwoFactorChallenge.execute(makeCtx(), { code: newCode });
      expect(attempt.ok).toBe(true);
      if (attempt.ok) expect(attempt.value.method).toBe("backup_code");
    }
  });
});
