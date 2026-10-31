/**
 * POST /api/capture/event
 *
 * Receives a notification capture event from the Android app and processes
 * it through the notification parser before persisting to capture_events.
 *
 * Authentication: JWT Bearer token (Supabase access token).
 * Rate limit: RATE_LIMITS.CAPTURE_EVENT — 60 requests per minute per user.
 * rawContent: capped at 2000 characters; not forwarded to the domain command.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@spencare/domain-infra";
import type { AuthContext } from "@spencare/domain-application";
import { processCaptureEvent, checkRateLimit, RATE_LIMITS, type IncomingCaptureEventPayload } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

const RAW_CONTENT_MAX_LENGTH = 2000;
// Rough body ceiling: JSON overhead + all fields. Rejects before parse when
// Content-Length is present; otherwise caught after parse via rawContent check.
const BODY_MAX_BYTES = 16_384;

async function validateBearerToken(
  authHeader: string | null,
): Promise<{ userId: string; email: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? "" };
}

export async function POST(request: NextRequest) {
  // ── Body-size guard (pre-parse, best-effort via Content-Length) ───────────
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > BODY_MAX_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const user = await validateBearerToken(request.headers.get("Authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Rate limit (per user, database-backed) ───────────────────────────────
  const serviceRole = createServiceRoleSupabaseClient();
  const allowed = await checkRateLimit(serviceRole, `capture_event:${user.userId}`, RATE_LIMITS.CAPTURE_EVENT);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // ── rawContent length guard ───────────────────────────────────────────────
  const { rawContent, ...payloadFields } = body;
  if (rawContent !== undefined) {
    if (typeof rawContent !== "string" || rawContent.length > RAW_CONTENT_MAX_LENGTH) {
      return NextResponse.json(
        { error: `rawContent must be a string of at most ${RAW_CONTENT_MAX_LENGTH} characters.` },
        { status: 400 },
      );
    }
  }

  // rawContent is intentionally dropped here — it is not forwarded to the
  // domain command and is never stored through this code path.
  const payload = payloadFields as unknown as IncomingCaptureEventPayload;

  // ── Build auth context ───────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const anonClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const ctx: AuthContext = {
    userId: user.userId,
    email: user.email,
    supabase: anonClient,
    serviceRoleSupabase: serviceRole,
  };

  // ── Process ───────────────────────────────────────────────────────────────
  let result;
  try {
    result = await processCaptureEvent(ctx, payload);
  } catch (err) {
    // Do not expose internal error details — log server-side only.
    const msg = err instanceof Error ? err.message : (typeof err === "object" && err !== null && "message" in err ? String((err as Record<string, unknown>).message) : String(err));
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as Record<string, unknown>).code) : "";
    console.error("[capture/event] processCaptureEvent error:", msg, code ? `(code=${code})` : "");
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  const responseStatus = result.duplicate || result.ignored || result.recovered ? 200 : 201;

  return NextResponse.json(
    {
      ok: true,
      eventId: result.eventId,
      status: result.status,
      duplicate: result.duplicate,
      ignored: result.ignored,
      recovered: result.recovered,
    },
    { status: responseStatus },
  );
}
