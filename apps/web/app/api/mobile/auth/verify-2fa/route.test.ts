import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  checkRateLimitSpy,
  getEncryptedTotpSecretSpy,
  decryptSecretSpy,
  getBackupCodeHashesSpy,
  consumeBackupCodeSpy,
  setBackupCodeHashesSpy,
  serviceClientFromSpy,
} = vi.hoisted(() => ({
  checkRateLimitSpy: vi.fn(),
  getEncryptedTotpSecretSpy: vi.fn(),
  decryptSecretSpy: vi.fn(),
  getBackupCodeHashesSpy: vi.fn(),
  consumeBackupCodeSpy: vi.fn(),
  setBackupCodeHashesSpy: vi.fn(),
  serviceClientFromSpy: vi.fn(),
}));

vi.mock("@spencare/domain-application", () => ({
  checkRateLimit: checkRateLimitSpy,
  RATE_LIMITS: {
    MOBILE_MFA_VERIFY: { maxAttempts: 5, windowSeconds: 300 },
  },
}));

vi.mock("@spencare/domain-infra", () => ({
  getEncryptedTotpSecret: getEncryptedTotpSecretSpy,
  decryptSecret: decryptSecretSpy,
  getBackupCodeHashes: getBackupCodeHashesSpy,
  setBackupCodeHashes: setBackupCodeHashesSpy,
}));

vi.mock("@spencare/domain-core", () => ({
  verifyTotpCode: vi.fn(() => false), // default: TOTP fails
  consumeBackupCode: consumeBackupCodeSpy,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({ from: serviceClientFromSpy })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_TOKEN = "a".repeat(64); // 64-char hex string (all 'a' is valid hex)
const VALID_CODE = "123456";

function buildRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/mobile/auth/verify-2fa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FUTURE = new Date(Date.now() + 600_000).toISOString();
const CHALLENGE_ROW = {
  id: "challenge-uuid",
  user_id: "user-uuid",
  encrypted_session: Buffer.from("enc").toString("base64"),
  expires_at: FUTURE,
  consumed_at: null,
};

const DECRYPTED_SESSION = JSON.stringify({
  access_token: "at",
  refresh_token: "rt",
  expires_at: 9999999999,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/mobile/auth/verify-2fa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitSpy.mockResolvedValue(true);
    getEncryptedTotpSecretSpy.mockResolvedValue(null);
    getBackupCodeHashesSpy.mockResolvedValue([]);
    consumeBackupCodeSpy.mockReturnValue({ matched: false, remainingHashes: [] });
    setBackupCodeHashesSpy.mockResolvedValue(undefined);
    decryptSecretSpy.mockReturnValue(DECRYPTED_SESSION);

    // Default chain: challenge found, consume succeeds
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: CHALLENGE_ROW }),
    });
  });

  it("returns 400 for missing challenge_token", async () => {
    const res = await POST(buildRequest({ code: VALID_CODE }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for challenge_token that is not 64 hex chars", async () => {
    const res = await POST(buildRequest({ challenge_token: "short", code: VALID_CODE }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty code", async () => {
    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    checkRateLimitSpy.mockResolvedValue(false);
    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: VALID_CODE }));
    expect(res.status).toBe(429);
  });

  it("returns 401 when challenge is not found", async () => {
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    });
    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: VALID_CODE }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when challenge is already consumed", async () => {
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...CHALLENGE_ROW, consumed_at: "2026-01-01T00:00:00Z" },
      }),
    });
    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: VALID_CODE }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when challenge is expired", async () => {
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...CHALLENGE_ROW, expires_at: new Date(0).toISOString() },
      }),
    });
    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: VALID_CODE }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when TOTP and backup code both fail", async () => {
    let callCount = 0;
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: CHALLENGE_ROW });
        return Promise.resolve({ data: null });
      }),
    });
    consumeBackupCodeSpy.mockReturnValue({ matched: false, remainingHashes: [] });
    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: VALID_CODE }));
    expect(res.status).toBe(401);
  });

  it("returns session tokens on valid backup code", async () => {
    consumeBackupCodeSpy.mockReturnValue({ matched: true, remainingHashes: [] });

    let callCount = 0;
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: CHALLENGE_ROW });
        return Promise.resolve({ data: { id: "challenge-uuid" } });
      }),
    });

    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: "ABCD-1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.access_token).toBe("at");
    expect(json.refresh_token).toBe("rt");
    expect(json.mfa_method).toBe("backup_code");
  });

  it("returns 409 when concurrent consume wins the race", async () => {
    consumeBackupCodeSpy.mockReturnValue({ matched: true, remainingHashes: [] });

    let callCount = 0;
    serviceClientFromSpy.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: CHALLENGE_ROW });
        return Promise.resolve({ data: null });
      }),
    });

    const res = await POST(buildRequest({ challenge_token: VALID_TOKEN, code: "ABCD-1234" }));
    expect(res.status).toBe(409);
  });
});
