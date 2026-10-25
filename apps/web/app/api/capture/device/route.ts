/**
 * POST /api/capture/device
 *
 * Registers or updates an Android device for capture event submission.
 * Called by the Android app on first launch after NotificationListenerService
 * is granted, and on subsequent launches to refresh device metadata and
 * permission state.
 *
 * Authentication: same JWT Bearer pattern as /api/capture/event.
 *
 * Response: the device registration row (id, name, access status, timestamps).
 * The Android app stores the returned `id` as its device registration ID and
 * includes it in subsequent capture event submissions.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  upsertDeviceRegistration,
  listDeviceRegistrations,
  revokeDeviceRegistration,
} from "@spencare/domain-infra";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

const BODY_MAX_BYTES = 4_096;

// ============================================================
// JWT validation helper (same as capture/event/route.ts)
// ============================================================

async function validateBearerToken(
  authHeader: string | null,
): Promise<{ userId: string } | null> {
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
  return { userId: data.user.id };
}

// ============================================================
// POST — register or update a device
// ============================================================

interface RegisterDeviceBody {
  deviceFingerprint: string;
  deviceName?: string;
  notificationAccessGranted?: boolean;
  smsPermissionGranted?: boolean;
}

export async function POST(request: NextRequest) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > BODY_MAX_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }

  const user = await validateBearerToken(request.headers.get("Authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const serviceRole = createServiceRoleSupabaseClient();

  const allowed = await checkRateLimit(serviceRole, `device_register:${user.userId}`, RATE_LIMITS.DEVICE_REGISTER);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  let body: RegisterDeviceBody;
  try {
    body = (await request.json()) as RegisterDeviceBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.deviceFingerprint || body.deviceFingerprint.trim().length === 0) {
    return NextResponse.json({ error: "deviceFingerprint is required." }, { status: 400 });
  }

  try {
    const row = await upsertDeviceRegistration(serviceRole, {
      userId: user.userId,
      deviceFingerprint: body.deviceFingerprint,
      deviceName: body.deviceName,
      notificationAccessGranted: body.notificationAccessGranted ?? false,
      smsPermissionGranted: body.smsPermissionGranted ?? false,
    });
    return NextResponse.json({ ok: true, device: row }, { status: 200 });
  } catch (err) {
    console.error("[capture/device POST] upsertDeviceRegistration error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

// ============================================================
// GET — list devices for the authenticated user
// ============================================================

export async function GET(request: NextRequest) {
  const user = await validateBearerToken(request.headers.get("Authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const serviceRole = createServiceRoleSupabaseClient();

  const allowed = await checkRateLimit(serviceRole, `device_list:${user.userId}`, RATE_LIMITS.DEVICE_LIST);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  try {
    const devices = await listDeviceRegistrations(serviceRole, user.userId);
    return NextResponse.json({ ok: true, devices }, { status: 200 });
  } catch (err) {
    console.error("[capture/device GET] listDeviceRegistrations error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

// ============================================================
// DELETE — revoke a device by id
// ============================================================

export async function DELETE(request: NextRequest) {
  const user = await validateBearerToken(request.headers.get("Authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { deviceId: string };
  try {
    body = (await request.json()) as { deviceId: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.deviceId) {
    return NextResponse.json({ error: "deviceId is required." }, { status: 400 });
  }

  const serviceRole = createServiceRoleSupabaseClient();

  const allowed = await checkRateLimit(serviceRole, `device_revoke:${user.userId}`, RATE_LIMITS.DEVICE_REVOKE);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  try {
    await revokeDeviceRegistration(serviceRole, user.userId, body.deviceId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[capture/device DELETE] revokeDeviceRegistration error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
