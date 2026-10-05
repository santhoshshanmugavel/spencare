import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 0 engine tests. The engine is responsible for loading privacy
 * mode once from `profiles` and passing it down to the composer. These
 * tests pin that handoff plus the per-channel preference gates
 * (in_app always on when subscribed; telegram respects channel + event
 * toggles). We mock the infra layer so these stay DB-free.
 */

const infraMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  createNotification: vi.fn(),
  createNotificationDelivery: vi.fn(),
  updateNotificationDelivery: vi.fn(),
  listNotificationPreferences: vi.fn(),
  getChannelConnectionMetadata: vi.fn(),
  isChannelEnabled: vi.fn(),
  isEventTypeEnabled: vi.fn(),
  isQuietHoursActive: vi.fn(),
  getQuietHours: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@spencare/domain-infra", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...infraMocks };
});
vi.mock("./telegramProvider", () => ({ sendTelegramMessage: providerMocks.sendTelegramMessage }));
vi.mock("./emailProvider", () => ({ sendNotificationEmail: providerMocks.sendNotificationEmail }));

// Set the key the engine requires before `import` evaluates.
process.env.CHANNEL_ENCRYPTION_KEY = "test-key-at-least-32-bytes-long-ok-for-tests";

import { deliverNotification } from "./engine";

function sb() {
  return {} as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  infraMocks.createNotification.mockResolvedValue({ id: "notif-1" });
  infraMocks.createNotificationDelivery.mockResolvedValue({ id: "del-1" });
  infraMocks.updateNotificationDelivery.mockResolvedValue(undefined);
  infraMocks.listNotificationPreferences.mockResolvedValue([]);
  infraMocks.isChannelEnabled.mockReturnValue(true);
  infraMocks.isEventTypeEnabled.mockReturnValue(true);
  infraMocks.isQuietHoursActive.mockReturnValue(false);
  infraMocks.getQuietHours.mockReturnValue(null);
  infraMocks.getChannelConnectionMetadata.mockResolvedValue({ chat_id: "123456" });
  providerMocks.sendTelegramMessage.mockResolvedValue({ ok: true, messageId: 42 });
});

describe("deliverNotification — privacy mode", () => {
  it("uses the DETAILED message when privacy_mode_enabled=false", async () => {
    infraMocks.getProfile.mockResolvedValue({ privacy_mode_enabled: false });

    await deliverNotification(sb(), {
      userId: "u1",
      userEmail: "x@test",
      eventType: "GOAL_CONTRIBUTION",
      financialContext: {
        goalName: "Emergency Fund",
        contributionMinor: 2000000,
        progressPct: 42,
        currency: "INR",
      },
      category: "goal",
      severity: "info",
    });

    const notifCall = infraMocks.createNotification.mock.calls[0]![1];
    expect(notifCall.title).toBe("Emergency Fund progress");
    expect(notifCall.body).toContain("₹20,000");
    expect(notifCall.body).toContain("Emergency Fund");

    const tgText = providerMocks.sendTelegramMessage.mock.calls[0]![1];
    expect(tgText).toContain("₹20,000");
    expect(tgText).toContain("Emergency Fund");
  });

  it("uses the PRIVATE message when privacy_mode_enabled=true (in-app AND telegram)", async () => {
    infraMocks.getProfile.mockResolvedValue({ privacy_mode_enabled: true });

    await deliverNotification(sb(), {
      userId: "u1",
      userEmail: "x@test",
      eventType: "GOAL_CONTRIBUTION",
      financialContext: {
        goalName: "Emergency Fund",
        contributionMinor: 2000000,
        progressPct: 42,
        currency: "INR",
      },
      category: "goal",
      severity: "info",
    });

    const notifCall = infraMocks.createNotification.mock.calls[0]![1];
    expect(notifCall.title).toBe("Goal contribution recorded");
    expect(notifCall.body).not.toMatch(/₹|20,000|Emergency Fund/);

    const tgText = providerMocks.sendTelegramMessage.mock.calls[0]![1];
    expect(tgText).not.toMatch(/₹|20,000|Emergency Fund/);
  });

  it("defaults to PRIVACY ON when profile read fails (safer than leaking)", async () => {
    infraMocks.getProfile.mockRejectedValue(new Error("boom"));

    await deliverNotification(sb(), {
      userId: "u1",
      userEmail: "x@test",
      eventType: "COMMITMENT_1_DAY",
      financialContext: {
        commitmentName: "Netflix",
        amountMinor: 64900,
        reservedMinor: 64900,
        currency: "INR",
      },
      category: "bill",
      severity: "info",
    });

    const notifCall = infraMocks.createNotification.mock.calls[0]![1];
    expect(notifCall.body).not.toMatch(/₹|649|Netflix/);
  });

  it("keeps SECURITY events detailed regardless of privacy mode", async () => {
    infraMocks.getProfile.mockResolvedValue({ privacy_mode_enabled: true });

    await deliverNotification(sb(), {
      userId: "u1",
      userEmail: "x@test",
      eventType: "SECURITY_NEW_LOGIN",
      financialContext: { location: "Bengaluru" },
      category: "security",
      severity: "warning",
    });

    const notifCall = infraMocks.createNotification.mock.calls[0]![1];
    expect(notifCall.body).toContain("Bengaluru");
  });
});

describe("deliverNotification — channel gates (unchanged behaviour)", () => {
  it("skips Telegram when telegram channel is disabled, in_app still delivered", async () => {
    infraMocks.getProfile.mockResolvedValue({ privacy_mode_enabled: false });
    infraMocks.isChannelEnabled.mockImplementation(
      (_prefs: unknown, channel: string) => channel !== "telegram",
    );

    await deliverNotification(sb(), {
      userId: "u1",
      userEmail: "x@test",
      eventType: "GOAL_CONTRIBUTION",
      financialContext: { goalName: "G", contributionMinor: 100, progressPct: 1, currency: "INR" },
      category: "goal",
      severity: "info",
    });

    expect(providerMocks.sendTelegramMessage).not.toHaveBeenCalled();
    const inAppDelivery = infraMocks.createNotificationDelivery.mock.calls.find(
      (c: unknown[]) => (c[1] as { channel: string }).channel === "in_app",
    );
    expect(inAppDelivery).toBeTruthy();
  });

  it("skips Telegram when the event type is disabled for telegram", async () => {
    infraMocks.getProfile.mockResolvedValue({ privacy_mode_enabled: false });
    infraMocks.isEventTypeEnabled.mockImplementation(
      (_prefs: unknown, channel: string) => channel !== "telegram",
    );

    await deliverNotification(sb(), {
      userId: "u1",
      userEmail: "x@test",
      eventType: "COMMITMENT_1_DAY",
      financialContext: { commitmentName: "X", amountMinor: 1, reservedMinor: 1, currency: "INR" },
      category: "bill",
      severity: "info",
    });

    expect(providerMocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});

describe("deliverNotification — idempotency (unchanged behaviour)", () => {
  it("short-circuits when createNotification returns null (duplicate dedupe_key)", async () => {
    infraMocks.getProfile.mockResolvedValue({ privacy_mode_enabled: false });
    infraMocks.createNotification.mockResolvedValueOnce(null);

    const result = await deliverNotification(sb(), {
      userId: "u1",
      userEmail: "x@test",
      eventType: "GOAL_CONTRIBUTION",
      financialContext: { goalName: "G", contributionMinor: 100, progressPct: 1, currency: "INR" },
      category: "goal",
      severity: "info",
      dedupeKey: "goal-contribution-u1-g-20261005",
    });

    expect(result.notificationId).toBeNull();
    expect(result.channels).toEqual([]);
    expect(infraMocks.createNotificationDelivery).not.toHaveBeenCalled();
    expect(providerMocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});
