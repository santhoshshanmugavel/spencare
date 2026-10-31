import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the infra layer only — the core parser is pure and tested directly.
vi.mock("@spencare/domain-infra", () => ({
  insertCaptureEvent: vi.fn(),
}));

// Distinct sentinel objects so vitest's deep-equality check can tell the two
// clients apart (both would otherwise be `{}` and compare as equal).
const ctx = {
  userId: "user-abc",
  email: "test@example.com",
  supabase: { __kind: "rls-client" } as never,
  serviceRoleSupabase: { __kind: "service-role-client" } as never,
};

// A well-formed HDFC debit notification — confidence >= 0.70
const HDFC_DEBIT_BODY =
  "HDFC Bank: INR 500.00 debited from A/c **1234 at SWIGGY on 11-10-2026. Ref No. HDFC9876543";

const BASE_PAYLOAD = {
  source: "android_notification" as const,
  sourceRefId: "sha256-abc123",
  packageName: "com.konylabs.hdfc",
  notificationTitle: "HDFC Bank",
  notificationBody: HDFC_DEBIT_BODY,
  deviceRegistrationId: "dev-reg-uuid",
  deviceReceivedAt: "2026-10-11T10:00:00.000Z",
};

const MOCK_ROW = {
  id: "capture-event-uuid",
  user_id: "user-abc",
  source: "android_notification",
  source_ref_id: "sha256-abc123",
  processing_status: "extracted",
  created_at: "2026-10-11T10:00:01Z",
  updated_at: "2026-10-11T10:00:01Z",
};

describe("processCaptureEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns extracted result with correct shape for a high-confidence financial notification", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(MOCK_ROW as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, BASE_PAYLOAD);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventId).toBe("capture-event-uuid");
    expect(result.status).toBe("extracted");
    expect(result.duplicate).toBe(false);
    expect(result.ignored).toBe(false);
  });

  it("passes ctx.userId — never a userId from the payload body", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(MOCK_ROW as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    await processCaptureEvent(ctx, BASE_PAYLOAD);

    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      ctx.serviceRoleSupabase,
      expect.objectContaining({ userId: "user-abc" }),
    );
    // The payload has no userId field — the insertion userId must come from ctx only
    expect(vi.mocked(insertCaptureEvent)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: expect.not.stringContaining("user-abc") }),
    );
  });

  it("uses serviceRoleSupabase for the insert, never the RLS-scoped client", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(MOCK_ROW as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    await processCaptureEvent(ctx, BASE_PAYLOAD);

    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      ctx.serviceRoleSupabase, // first argument must be the service-role client
      expect.any(Object),
    );
    expect(vi.mocked(insertCaptureEvent)).not.toHaveBeenCalledWith(
      ctx.supabase,
      expect.any(Object),
    );
  });

  it("returns ok:false when sourceRefId is missing", async () => {
    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, { ...BASE_PAYLOAD, sourceRefId: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/sourceRefId/i);
  });

  it("returns ok:false when notificationBody is an empty string (malformed normal request)", async () => {
    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, { ...BASE_PAYLOAD, notificationBody: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/notificationBody/i);
  });

  it("recovery path: returns ok:true with status=recovered when notificationBody is absent", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue({
      ...MOCK_ROW,
      processing_status: "recovered",
      id: "recovery-uuid",
    } as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, {
      ...BASE_PAYLOAD,
      notificationTitle: undefined,
      notificationBody: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("recovered");
    expect(result.recovered).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.ignored).toBe(false);
    expect(result.eventId).toBe("recovery-uuid");
    // Must not run extraction — insert contains only metadata fields, no extracted* keys
    const call = vi.mocked(insertCaptureEvent).mock.calls[0]![1];
    expect(call.processingStatus).toBe("recovered");
    expect(call.parserVersion).toBeNull();
    expect(call).not.toHaveProperty("extractedAmountMinor");
    expect(call).not.toHaveProperty("extractedType");
  });

  it("recovery path: duplicate recovery event returns ok:true with status=duplicate", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(null as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, {
      ...BASE_PAYLOAD,
      notificationBody: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("duplicate");
    expect(result.duplicate).toBe(true);
    expect(result.recovered).toBe(false);
  });

  it("returns ok:false when packageName is missing", async () => {
    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, { ...BASE_PAYLOAD, packageName: "" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/packageName/i);
  });

  it("returns ok:false for an unsupported capture source", async () => {
    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, {
      ...BASE_PAYLOAD,
      source: "sms" as never, // Phase 2 only supports android_notification
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/source/i);
  });

  it("returns duplicate:true when the repository signals a duplicate (null return)", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(null as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, BASE_PAYLOAD);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(true);
    expect(result.status).toBe("duplicate");
    expect(result.ignored).toBe(false);
  });

  it("stores ignored:true for an OTP notification — OTP text must never become a financial record", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue({
      ...MOCK_ROW,
      processing_status: "ignored",
    } as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, {
      ...BASE_PAYLOAD,
      notificationBody:
        "Your OTP for HDFC NetBanking is 123456. Valid for 10 minutes. Do not share.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ignored).toBe(true);
    expect(result.status).toBe("ignored");
    // The insert must have been called with ignored status and no extracted fields
    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        processingStatus: "ignored",
        extractedAmountMinor: null,
        extractedType: null,
      }),
    );
  });

  it("stores ignored:true for a failed-transaction notification — pending/failed payments are NOT expenses", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue({
      ...MOCK_ROW,
      processing_status: "ignored",
    } as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, {
      ...BASE_PAYLOAD,
      notificationBody:
        "HDFC Bank: Your UPI payment of INR 500.00 to SWIGGY has FAILED. Ref No. HDFC9876543",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ignored).toBe(true);
    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ processingStatus: "ignored" }),
    );
  });

  it("stores ignored:true and null extracted fields for a non-financial notification", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue({
      ...MOCK_ROW,
      processing_status: "ignored",
    } as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    const result = await processCaptureEvent(ctx, {
      ...BASE_PAYLOAD,
      packageName: "com.amazon.mShop.android.shopping",
      notificationBody: "Your Amazon order has been shipped!",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ignored).toBe(true);
    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        processingStatus: "ignored",
        extractedAmountMinor: null,
        extractedType: null,
        confidence: null,
      }),
    );
  });

  it("populates extracted fields for a high-confidence financial event", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(MOCK_ROW as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    await processCaptureEvent(ctx, BASE_PAYLOAD);

    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        processingStatus: "extracted",
        extractedAmountMinor: 50000, // ₹500.00 → 50000 minor units
        extractedType: "expense",    // "debited" → expense
        extractedCurrency: "INR",
      }),
    );
  });

  it("does not forward rawContent to the repository (privacy default)", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(MOCK_ROW as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    await processCaptureEvent(ctx, { ...BASE_PAYLOAD, rawContent: HDFC_DEBIT_BODY });

    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ rawContent: expect.any(String) }),
    );
  });

  it("propagates a repository error — does not swallow unexpected failures", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockRejectedValue(new Error("DB connection lost"));

    const { processCaptureEvent } = await import("./captureEvent.js");
    await expect(processCaptureEvent(ctx, BASE_PAYLOAD)).rejects.toThrow(
      "DB connection lost",
    );
  });

  it("propagates a non-Error Supabase PostgrestError (FK violation) without swallowing it", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    // PostgrestError is not an Error instance — it is a plain object with message+code
    const postgrestError = { message: "FK violation on device_registration_id", code: "23503", details: null, hint: null };
    vi.mocked(insertCaptureEvent).mockRejectedValue(postgrestError);

    const { processCaptureEvent } = await import("./captureEvent.js");
    await expect(processCaptureEvent(ctx, BASE_PAYLOAD)).rejects.toMatchObject({ code: "23503" });
  });

  it("always passes deviceRegistrationId: null to the repository (Phase 3 not yet implemented)", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(MOCK_ROW as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    // Even when the payload carries a device UUID, the command must not forward it as a FK value
    await processCaptureEvent(ctx, { ...BASE_PAYLOAD, deviceRegistrationId: "some-device-uuid" });

    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deviceRegistrationId: null }),
    );
  });

  it("recovery path: always passes deviceRegistrationId: null to the repository", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue({
      ...MOCK_ROW,
      processing_status: "recovered",
      id: "recovery-uuid-2",
    } as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    await processCaptureEvent(ctx, {
      ...BASE_PAYLOAD,
      notificationBody: undefined,
      deviceRegistrationId: "some-device-uuid",
    });

    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deviceRegistrationId: null }),
    );
  });

  it("includes the NOTIFICATION_PARSER_VERSION in every insert", async () => {
    const { insertCaptureEvent } = await import("@spencare/domain-infra");
    vi.mocked(insertCaptureEvent).mockResolvedValue(MOCK_ROW as never);

    const { processCaptureEvent } = await import("./captureEvent.js");
    await processCaptureEvent(ctx, BASE_PAYLOAD);

    expect(vi.mocked(insertCaptureEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ parserVersion: "android-notif-v1" }),
    );
  });
});
