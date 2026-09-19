"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, X, Check, CheckCheck, Info, AlertTriangle, AlertCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

interface NotificationItem {
  id: string;
  title: string | null;
  body: string | null;
  severity: "info" | "warning" | "critical" | "success";
  category: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

const SEVERITY_ICON: Record<string, React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
  success: Sparkles,
};

const SEVERITY_COLOR: Record<string, string> = {
  info: "text-blue-500",
  warning: "text-warning",
  critical: "text-destructive",
  success: "text-success",
};

export function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=30");
      if (!res.ok) return;
      const data = await res.json() as { notifications: NotificationItem[]; unreadCount: number };
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchNotifications();
    }
  }, [open, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Poll unread count every 60s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/notifications?limit=1");
        if (!res.ok) return;
        const data = await res.json() as { unreadCount: number };
        setUnreadCount(data.unreadCount);
      } catch {
        // ignore
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  async function markRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => undefined);
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnreadCount(0);
    await fetch("/api/notifications", { method: "DELETE" }).catch(() => undefined);
  }

  return (
    <div ref={panelRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
            className={cn(
              "relative flex size-11 items-center justify-center rounded-full transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              open
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Bell className="size-5" aria-hidden="true" />
            {unreadCount > 0 ? (
              <span
                className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white"
                aria-hidden="true"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Notifications</TooltipContent>
      </Tooltip>

      {open ? (
        <div className="absolute bottom-full left-full mb-0 ml-2 z-50 w-96 rounded-[var(--radius-lg)] border border-border bg-background shadow-popover overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                  Mark all read
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Close notifications"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[480px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Bell className="size-8 text-muted-foreground/40" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">Nothing here yet</p>
              </div>
            ) : (
              <ul>
                {notifications.map((n) => {
                  const SeverityIcon = SEVERITY_ICON[n.severity] ?? Info;
                  const colorClass = SEVERITY_COLOR[n.severity] ?? "text-blue-500";
                  const isUnread = !n.read_at;

                  const inner = (
                    <div
                      className={cn(
                        "flex gap-3 px-4 py-3 transition-colors",
                        isUnread ? "bg-primary/5" : "",
                        "hover:bg-muted/50",
                      )}
                    >
                      <SeverityIcon className={cn("mt-0.5 size-4 shrink-0", colorClass)} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm leading-snug", isUnread ? "font-medium text-foreground" : "text-foreground")}>
                          {n.title}
                        </p>
                        {n.body ? (
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">{n.body}</p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-muted-foreground/60">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      {isUnread ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void markRead(n.id); }}
                          className="shrink-0 self-start rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          aria-label="Mark as read"
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  );

                  return (
                    <li key={n.id} className="border-b border-border/50 last:border-0">
                      {n.action_url ? (
                        <a href={n.action_url} onClick={() => { if (isUnread) void markRead(n.id); setOpen(false); }} className="block">
                          {inner}
                        </a>
                      ) : (
                        <div onClick={() => { if (isUnread) void markRead(n.id); }}>
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2.5">
            <a
              href="/settings/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Notification settings
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
