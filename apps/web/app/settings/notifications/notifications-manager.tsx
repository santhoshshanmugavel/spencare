"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Bell,
  Send,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Unlink,
  Copy,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ChannelConnectionRow, NotificationPreferenceRow } from "@spencare/domain-application";

interface NotificationsManagerProps {
  channelConnections: ChannelConnectionRow[];
  preferences: NotificationPreferenceRow[];
}

type TelegramPhase =
  | "idle"       // Not connected
  | "fetching"   // Generating token
  | "waiting"    // Link opened, polling for connection
  | "connected"  // Successfully linked
  | "error";     // Something went wrong

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_COUNT = 40; // 2 minutes

export function NotificationsManager({
  channelConnections,
  preferences,
}: NotificationsManagerProps) {
  const [prefs, setPrefs] = useState(preferences);
  const [connections, setConnections] = useState(channelConnections);

  const telegramConnection = connections.find((c) => c.channel === "telegram" && c.status === "connected");

  const [telegramPhase, setTelegramPhase] = useState<TelegramPhase>(
    telegramConnection ? "connected" : "idle",
  );
  const [telegramDeepLink, setTelegramDeepLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [testMessageState, setTestMessageState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollCount.current = 0;
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollCount.current = 0;

    pollRef.current = setInterval(async () => {
      pollCount.current += 1;
      if (pollCount.current > POLL_MAX_COUNT) {
        stopPolling();
        // Don't show error — they may have not finished yet; just leave "waiting"
        return;
      }

      try {
        const res = await fetch("/api/notifications/channels/telegram");
        if (!res.ok) return;
        const data = (await res.json()) as { connection: ChannelConnectionRow | null };
        if (data.connection?.status === "connected") {
          stopPolling();
          setConnections((prev) => {
            const filtered = prev.filter((c) => c.channel !== "telegram");
            return [...filtered, data.connection!];
          });
          setTelegramPhase("connected");
          setTelegramDeepLink(null);
        }
      } catch {
        // Network error — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const getChannelEnabled = useCallback(
    (channel: string): boolean => {
      const pref = prefs.find((p) => p.channel === channel && p.event_type === null);
      if (!pref) return channel === "email" || channel === "in_app";
      return pref.enabled;
    },
    [prefs],
  );

  const setChannelEnabled = useCallback(async (channel: string, enabled: boolean) => {
    const res = await fetch("/api/notifications/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, enabled }),
    });
    if (!res.ok) return;
    setPrefs((prev) => {
      const existing = prev.findIndex((p) => p.channel === channel && p.event_type === null);
      if (existing >= 0) {
        return prev.map((p, i) => (i === existing ? { ...p, enabled } : p));
      }
      return [...prev, { channel, enabled, event_type: null } as NotificationPreferenceRow];
    });
  }, []);

  async function handleTelegramConnect() {
    setTelegramPhase("fetching");
    try {
      const res = await fetch("/api/notifications/telegram/connect", { method: "POST" });
      if (!res.ok) {
        setTelegramPhase("error");
        return;
      }
      const data = (await res.json()) as { url: string };
      setTelegramDeepLink(data.url);
      setTelegramPhase("waiting");
      window.open(data.url, "_blank", "noopener,noreferrer");
      startPolling();
    } catch {
      setTelegramPhase("error");
    }
  }

  async function handleCopyLink() {
    if (!telegramDeepLink) return;
    try {
      await navigator.clipboard.writeText(telegramDeepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  }

  async function handleRetry() {
    setTelegramPhase("idle");
    setTelegramDeepLink(null);
    stopPolling();
  }

  async function handleSendTestMessage() {
    setTestMessageState("sending");
    try {
      const res = await fetch("/api/notifications/telegram/test", { method: "POST" });
      setTestMessageState(res.ok ? "sent" : "error");
      if (res.ok) setTimeout(() => setTestMessageState("idle"), 3000);
    } catch {
      setTestMessageState("error");
    }
  }

  async function handleDisconnect() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    setDisconnecting(true);
    setConfirmDisconnect(false);
    try {
      const res = await fetch("/api/notifications/channels/telegram", { method: "DELETE" });
      if (!res.ok) return;
      setConnections((prev) => prev.filter((c) => c.channel !== "telegram"));
      setTelegramPhase("idle");
      setTelegramDeepLink(null);
      await setChannelEnabled("telegram", false);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base font-semibold text-foreground mb-1">Channels</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose how Spencare reaches you when something matters.
        </p>

        <div className="divide-y divide-border rounded-xl border border-border bg-card px-4">
          {/* In-app — always on */}
          <div className="flex items-start gap-4 py-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Bell className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">In-app</p>
              <p className="text-xs text-muted-foreground mt-0.5">Bell icon in the sidebar. Always on.</p>
            </div>
            <div className="shrink-0 flex items-center">
              <Switch
                id="channel-in_app"
                checked={true}
                disabled
                aria-label="In-app notifications (always on)"
              />
            </div>
          </div>

          {/* Telegram */}
          <div className="py-4">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Send className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>

              <div className="flex-1 min-w-0">
                {telegramPhase === "connected" && telegramConnection ? (
                  <>
                    <p className="text-sm font-medium text-foreground">Telegram</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Connected
                      {telegramConnection.display_name ? ` as ${telegramConnection.display_name}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Spensa can send important financial updates here.
                    </p>
                  </>
                ) : telegramPhase === "waiting" ? (
                  <>
                    <p className="text-sm font-medium text-foreground">Telegram</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Waiting for you to complete the connection in Telegram…
                    </p>
                  </>
                ) : telegramPhase === "error" ? (
                  <>
                    <p className="text-sm font-medium text-foreground">Telegram</p>
                    <p className="text-xs text-destructive mt-0.5">
                      Something went wrong. Please try again.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">Telegram</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Send notifications to your Telegram account via @Spencare_bot
                    </p>
                  </>
                )}
              </div>

              {/* Right-side actions */}
              <div className="shrink-0 flex items-center gap-2">
                {telegramPhase === "connected" ? (
                  <>
                    <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                    {confirmDisconnect ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDisconnect(false)}
                          className="h-8 px-2 text-xs text-muted-foreground"
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDisconnect()}
                          disabled={disconnecting}
                          className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                        >
                          {disconnecting ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Unlink className="size-3.5" aria-hidden="true" />
                          )}
                          <span className="ml-1.5">Confirm</span>
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDisconnect()}
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                      >
                        <Unlink className="size-3.5" aria-hidden="true" />
                        <span className="ml-1.5">Disconnect</span>
                      </Button>
                    )}
                  </>
                ) : telegramPhase === "waiting" ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                ) : telegramPhase === "fetching" ? (
                  <Button variant="outline" size="sm" disabled className="h-8 text-xs">
                    <Loader2 className="size-3.5 animate-spin mr-1.5" aria-hidden="true" />
                    Preparing…
                  </Button>
                ) : telegramPhase === "error" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRetry()}
                    className="h-8 text-xs"
                  >
                    <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
                    Try again
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleTelegramConnect()}
                    className="h-8 text-xs"
                  >
                    <ExternalLink className="size-3.5 mr-1.5" aria-hidden="true" />
                    Connect
                  </Button>
                )}
              </div>
            </div>

            {/* Sub-row: Send test message (when connected) */}
            {telegramPhase === "connected" && (
              <div className="mt-3 ml-14">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleSendTestMessage()}
                  disabled={testMessageState === "sending"}
                  className={cn(
                    "h-8 text-xs",
                    testMessageState === "sent" && "text-success",
                    testMessageState === "error" && "text-destructive",
                  )}
                >
                  {testMessageState === "sending" ? (
                    <Loader2 className="size-3.5 animate-spin mr-1.5" aria-hidden="true" />
                  ) : testMessageState === "sent" ? (
                    <CheckCircle2 className="size-3.5 mr-1.5" aria-hidden="true" />
                  ) : (
                    <Send className="size-3.5 mr-1.5" aria-hidden="true" />
                  )}
                  {testMessageState === "sent"
                    ? "Sent!"
                    : testMessageState === "error"
                      ? "Delivery failed"
                      : "Send test message"}
                </Button>
              </div>
            )}

            {/* Sub-row: waiting state with fallback link */}
            {telegramPhase === "waiting" && telegramDeepLink ? (
              <div className="mt-3 ml-14 rounded-lg bg-muted px-3 py-2.5 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Telegram should have opened. Press <strong>Start</strong> in the bot chat to complete
                  the connection.
                </p>
                <div className="flex items-center gap-2">
                  <a
                    href={telegramDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                  >
                    <ExternalLink className="size-3" aria-hidden="true" />
                    Open Telegram
                  </a>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="size-3" aria-hidden="true" />
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Alert category toggles */}
      <section>
        <h2 className="text-base font-semibold text-foreground mb-1">Alert types</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Turn off entire categories when they're not relevant to you.
        </p>

        <div className="divide-y divide-border rounded-xl border border-border bg-card px-4">
          {ALERT_CATEGORIES.map((cat) => {
            const pref = prefs.find(
              (p) => p.channel === "in_app" && p.event_type === cat.eventTypePrefix,
            );
            const enabled = pref ? pref.enabled : true;
            return (
              <div key={cat.key} className="flex items-center gap-4 py-3.5">
                <div className="flex-1 min-w-0">
                  <Label
                    htmlFor={`cat-${cat.key}`}
                    className="text-sm font-medium text-foreground cursor-pointer"
                  >
                    {cat.label}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{cat.description}</p>
                </div>
                <Switch
                  id={`cat-${cat.key}`}
                  checked={enabled}
                  onCheckedChange={async (checked) => {
                    await fetch("/api/notifications/preferences", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        channel: "in_app",
                        eventType: cat.eventTypePrefix,
                        enabled: checked,
                      }),
                    });
                    setPrefs((prev) => {
                      const idx = prev.findIndex(
                        (p) =>
                          p.channel === "in_app" && p.event_type === cat.eventTypePrefix,
                      );
                      if (idx >= 0)
                        return prev.map((p, i) => (i === idx ? { ...p, enabled: checked } : p));
                      return [
                        ...prev,
                        {
                          channel: "in_app",
                          event_type: cat.eventTypePrefix,
                          enabled: checked,
                        } as NotificationPreferenceRow,
                      ];
                    });
                  }}
                  aria-label={`Toggle ${cat.label} notifications`}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const ALERT_CATEGORIES = [
  {
    key: "budget",
    label: "Budget alerts",
    description: "When your spending approaches or passes a budget limit",
    eventTypePrefix: "BUDGET_50",
  },
  {
    key: "balance",
    label: "Balance warnings",
    description: "When an account balance drops low or goes negative",
    eventTypePrefix: "BALANCE_LOW",
  },
  {
    key: "bill",
    label: "Bill reminders",
    description: "Upcoming and overdue bill payment reminders",
    eventTypePrefix: "BILL_7_DAYS",
  },
  {
    key: "goal",
    label: "Goal milestones",
    description: "Progress updates when you hit key goal milestones",
    eventTypePrefix: "GOAL_25",
  },
  {
    key: "security",
    label: "Security alerts",
    description: "Password changes, new logins, and 2FA changes",
    eventTypePrefix: "SECURITY_PASSWORD_CHANGED",
  },
  {
    key: "reports",
    label: "Weekly & monthly summaries",
    description: "A quick look at your spending at the end of each period",
    eventTypePrefix: "WEEKLY_SUMMARY",
  },
] as const;
