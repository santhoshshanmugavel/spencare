import type { TypedSupabaseClient } from "@spencare/domain-infra";
import { deliverNotification } from "./engine";

// ─── Timezone helpers (exported for unit testing) ─────────────────────────────

/**
 * Convert a local (wall-clock) date + time to a UTC timestamp in milliseconds.
 *
 * Works correctly across DST transitions: the offset is derived from Intl at
 * the exact local moment requested, not hardcoded.
 *
 * @param localDate        "YYYY-MM-DD"
 * @param localTimeHHMMSS  "HH:MM:SS"
 * @param timezone         IANA timezone string, e.g. "Asia/Kolkata"
 * @param additionalMs     Sub-second tail (e.g. 999 for end-of-day 23:59:59.999)
 */
export function localDatetimeToUtcMs(
  localDate: string,
  localTimeHHMMSS: string,
  timezone: string,
  additionalMs = 0,
): number {
  // Treat the local datetime naively as UTC — just a reference anchor.
  const nominalMs = Date.parse(`${localDate}T${localTimeHHMMSS}Z`);

  // Ask Intl: "what does this UTC instant look like in the target timezone?"
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nominalMs));
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10);

  // How many ms ahead (+) or behind (-) is the timezone at this moment?
  const shownAsUtcMs = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  );
  const offsetMs = shownAsUtcMs - nominalMs;

  // Actual UTC instant whose local representation is localDate + localTimeHHMMSS.
  return nominalMs - offsetMs + additionalMs;
}

/**
 * Current local calendar date (YYYY-MM-DD) in the given IANA timezone.
 * Accepts an optional `now` so unit tests can inject a fixed instant.
 */
export function getLocalDate(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

/**
 * Current local hour (0–23) in the given IANA timezone.
 * Accepts an optional `now` so unit tests can inject a fixed instant.
 */
export function getLocalHour(timezone: string, now: Date = new Date()): number {
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "numeric", hour12: false,
  }).format(now);
  // Some implementations return "24" for midnight; normalise to 0.
  return parseInt(raw, 10) % 24;
}

// ─── UTC date bounds ──────────────────────────────────────────────────────────

export interface UtcBounds {
  start: string; // ISO UTC for 00:00:00.000 local
  end: string;   // ISO UTC for 23:59:59.999 local
}

/**
 * Return the UTC start/end ISO strings that bracket an entire local calendar
 * day, accounting for the user's timezone (including DST).
 */
export function getLocalDateBoundsUtc(localDate: string, timezone: string): UtcBounds {
  return {
    start: new Date(localDatetimeToUtcMs(localDate, "00:00:00", timezone)).toISOString(),
    end: new Date(localDatetimeToUtcMs(localDate, "23:59:59", timezone, 999)).toISOString(),
  };
}

// ─── Financial context ────────────────────────────────────────────────────────

export interface DailySummaryContext {
  spentMinor: number;
  incomeMinor: number;
  netMinor: number;
  transactionCount: number;
  topCategoryName: string | null;
  insight: string | null;
  hasActivity: boolean;
  currency: string;
}

/**
 * Query today's transactions for a single user and build the financial
 * summary context.
 *
 * Financial rules applied:
 * - Only `expense` and `income` types count; transfers, goal contributions and
 *   withdrawals are excluded per Spencare accounting rules.
 * - Soft-deleted rows (deleted_at IS NOT NULL) are excluded.
 * - Transfer legs (transfer_pair_id IS NOT NULL) are excluded even when the
 *   `type` is `expense`/`income` due to data inconsistencies.
 * - `amount_minor` is always treated as positive for expenses (abs value).
 */
async function buildDailySummaryContext(
  supabase: TypedSupabaseClient,
  userId: string,
  utcBounds: UtcBounds,
  preferredCurrency: string,
): Promise<DailySummaryContext> {
  const { data: txRows } = await supabase
    .from("transactions")
    .select("amount_minor, currency, category_id, type")
    .eq("user_id", userId)
    .in("type", ["expense", "income"])
    .is("deleted_at", null)
    .is("transfer_pair_id", null)
    .gte("occurred_at", utcBounds.start)
    .lte("occurred_at", utcBounds.end);

  if (!txRows || txRows.length === 0) {
    return {
      spentMinor: 0,
      incomeMinor: 0,
      netMinor: 0,
      transactionCount: 0,
      topCategoryName: null,
      insight: null,
      hasActivity: false,
      currency: preferredCurrency,
    };
  }

  let spentMinor = 0;
  let incomeMinor = 0;
  const categorySpend: Record<string, number> = {};
  const currency = txRows[0]?.currency ?? preferredCurrency;

  for (const tx of txRows) {
    const abs = Math.abs(tx.amount_minor);
    if (tx.type === "expense") {
      spentMinor += abs;
      if (tx.category_id) {
        categorySpend[tx.category_id] = (categorySpend[tx.category_id] ?? 0) + abs;
      }
    } else if (tx.type === "income") {
      incomeMinor += abs;
    }
  }

  const netMinor = incomeMinor - spentMinor;

  // Resolve top spending category name (single DB call, only when there is spend)
  let topCategoryName: string | null = null;
  const topCategoryId = Object.entries(categorySpend).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topCategoryId) {
    const { data: cat } = await supabase
      .from("categories")
      .select("name")
      .eq("id", topCategoryId)
      .single();
    topCategoryName = cat?.name ?? null;
  }

  return {
    spentMinor,
    incomeMinor,
    netMinor,
    transactionCount: txRows.length,
    topCategoryName,
    insight: null,
    hasActivity: true,
    currency,
  };
}

// ─── Run options ──────────────────────────────────────────────────────────────

export interface RunOptions {
  /**
   * Skip the local-hour window check and process all eligible users immediately.
   * The dedupe key still uses the user's real local date, so sending twice on
   * the same calendar day is still idempotent.
   */
  force?: boolean;
  /**
   * Restrict processing to a single user ID.  Used together with force for
   * targeted production testing without affecting all users.
   */
  targetUserId?: string;
  /**
   * Inject a fixed "now" for unit testing.  Production code must never set this.
   */
  now?: Date;
}

// ─── Per-user runner ──────────────────────────────────────────────────────────

async function runDailySummaryForUser(
  supabase: TypedSupabaseClient,
  user: { id: string; email: string; timezone: string | null; preferredCurrency: string },
  opts: RunOptions = {},
): Promise<"sent" | "skipped_hour" | "skipped_dedupe" | "error"> {
  const timezone = user.timezone ?? "UTC";
  const now = opts.now ?? new Date();

  if (!opts.force) {
    // Deliver only during 23:00–23:59 in the user's local timezone.
    // The hourly pg_cron job fires once per hour; any user whose local hour is
    // currently 23 will be caught by exactly one of those 24 daily firings.
    const localHour = getLocalHour(timezone, now);
    if (localHour !== 23) return "skipped_hour";
  }

  const localDate = getLocalDate(timezone, now);
  const dedupeKey = `daily_summary:${user.id}:${localDate}`;

  try {
    const utcBounds = getLocalDateBoundsUtc(localDate, timezone);
    const ctx = await buildDailySummaryContext(supabase, user.id, utcBounds, user.preferredCurrency);

    const result = await deliverNotification(supabase, {
      userId: user.id,
      userEmail: user.email,
      eventType: "DAILY_SUMMARY",
      financialContext: ctx as unknown as Record<string, unknown>,
      category: "report",
      severity: "info",
      dedupeKey,
    });

    if (result.notificationId === null) return "skipped_dedupe";
    return "sent";
  } catch (err) {
    console.error(`[daily-summary] error for user ${user.id}:`, err);
    return "error";
  }
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export interface DailySummaryReport {
  sent: number;
  skipped_hour: number;
  skipped_dedupe: number;
  error: number;
  total: number;
}

export async function runDailySummaries(
  supabase: TypedSupabaseClient,
  opts: RunOptions = {},
): Promise<DailySummaryReport> {
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, timezone, preferred_currency")
    .not("user_id", "is", null);

  if (!profiles || profiles.length === 0) {
    return { sent: 0, skipped_hour: 0, skipped_dedupe: 0, error: 0, total: 0 };
  }

  const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  for (const u of authUsers?.users ?? []) {
    emailMap.set(u.id, u.email ?? "");
  }

  const eligible = opts.targetUserId
    ? profiles.filter(p => p.user_id === opts.targetUserId)
    : profiles;

  const report: DailySummaryReport = {
    sent: 0, skipped_hour: 0, skipped_dedupe: 0, error: 0, total: eligible.length,
  };

  for (const profile of eligible) {
    const userId = profile.user_id;
    const email = emailMap.get(userId) ?? "";
    if (!email) {
      console.warn(`[daily-summary] no email found for user ${userId}`);
      report.error++;
      continue;
    }
    const outcome = await runDailySummaryForUser(supabase, {
      id: userId,
      email,
      timezone: profile.timezone ?? null,
      preferredCurrency: profile.preferred_currency ?? "USD",
    }, opts);
    report[outcome]++;
  }

  return report;
}
