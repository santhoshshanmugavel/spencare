/**
 * Capture Events + Device Registrations repository (ATC Phase 2).
 *
 * Depends on the 20261011000002_atc_foundation.sql migration being applied.
 * Until that migration is applied to a given environment, calling these
 * functions will throw a Supabase 42P01 (relation does not exist) error.
 *
 * NOTE: capture_events and device_registrations are now present in
 * packages/domain/infra/src/generated/database.types.ts (generated from
 * local Supabase after applying 20261011000002_atc_foundation.sql).
 * Regenerate when the migration is applied to production:
 *   supabase gen types typescript --project-id wjaxxoselhlbjrtuhqlq \
 *     > packages/domain/infra/src/generated/database.types.ts
 */

import type { TypedSupabaseClient } from "./supabaseClients.js";

// ============================================================
// Local row interfaces (mirrors 20261011000002_atc_foundation.sql)
// ============================================================

export type CaptureSource =
  | "android_notification"
  | "sms"
  | "gmail"
  | "statement"
  | "manual";

export type CaptureProcessingStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "failed"
  | "duplicate"
  | "ignored"
  | "promoted"
  | "recovered";

export interface CaptureEventRow {
  id: string;
  user_id: string;
  source: CaptureSource;
  source_ref_id: string;
  device_registration_id: string | null;
  extracted_amount_minor: number | null;
  extracted_currency: string | null;
  extracted_type: string | null;
  extracted_merchant: string | null;
  extracted_occurred_at: string | null;
  extracted_reference_id: string | null;
  extracted_account_hint: string | null;
  confidence: number | null;
  raw_content: string | null;
  raw_content_expires_at: string | null;
  processing_status: CaptureProcessingStatus;
  parser_version: string | null;
  error_message: string | null;
  retry_count: number;
  promoted_candidate_id: string | null;
  created_transaction_id: string | null;
  device_received_at: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceRegistrationRow {
  id: string;
  user_id: string;
  device_fingerprint: string;
  device_name: string;
  notification_access_granted: boolean;
  sms_permission_granted: boolean;
  revoked_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Insert types
// ============================================================

export interface InsertCaptureEventInput {
  userId: string;
  source: CaptureSource;
  sourceRefId: string;
  deviceRegistrationId?: string | null;
  extractedAmountMinor?: number | null;
  extractedCurrency?: string | null;
  extractedType?: string | null;
  extractedMerchant?: string | null;
  extractedOccurredAt?: string | null;
  extractedReferenceId?: string | null;
  extractedAccountHint?: string | null;
  confidence?: number | null;
  rawContent?: string | null;
  processingStatus?: CaptureProcessingStatus;
  parserVersion?: string | null;
  errorMessage?: string | null;
  deviceReceivedAt?: string | null;
}

export interface UpsertDeviceRegistrationInput {
  userId: string;
  deviceFingerprint: string;
  deviceName?: string;
  notificationAccessGranted?: boolean;
  smsPermissionGranted?: boolean;
}

// ============================================================
// capture_events
// ============================================================

/**
 * Inserts a new capture event. Callers MUST use the service-role client
 * because this bypasses RLS; user_id is set explicitly from the
 * authenticated JWT, not from auth.uid().
 *
 * Returns the new row or null if the source_ref_id already exists for
 * this user+source (duplicate — the unique constraint violation is
 * caught and converted to a null return rather than a throw).
 */
export async function insertCaptureEvent(
  serviceRoleClient: TypedSupabaseClient,
  input: InsertCaptureEventInput,
): Promise<CaptureEventRow | null> {
  const rawContentExpiresAt = input.rawContent
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data, error } = await serviceRoleClient
    .from("capture_events")
    .insert({
      user_id: input.userId,
      source: input.source,
      source_ref_id: input.sourceRefId,
      device_registration_id: input.deviceRegistrationId ?? null,
      extracted_amount_minor: input.extractedAmountMinor ?? null,
      extracted_currency: input.extractedCurrency ?? null,
      extracted_type: input.extractedType ?? null,
      extracted_merchant: input.extractedMerchant ?? null,
      extracted_occurred_at: input.extractedOccurredAt ?? null,
      extracted_reference_id: input.extractedReferenceId ?? null,
      extracted_account_hint: input.extractedAccountHint ?? null,
      confidence: input.confidence ?? null,
      raw_content: input.rawContent ?? null,
      raw_content_expires_at: rawContentExpiresAt,
      processing_status: input.processingStatus ?? "extracted",
      parser_version: input.parserVersion ?? null,
      error_message: input.errorMessage ?? null,
      device_received_at: input.deviceReceivedAt ?? null,
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation (duplicate source_ref_id)
    if (error.code === "23505") return null;
    throw error;
  }

  return data as CaptureEventRow;
}

/**
 * Updates the processing_status (and optionally error_message) of an
 * existing capture event. Used by the processing pipeline to advance
 * the event through its lifecycle.
 */
export async function updateCaptureEventStatus(
  serviceRoleClient: TypedSupabaseClient,
  id: string,
  status: CaptureProcessingStatus,
  extra?: { errorMessage?: string; promotedCandidateId?: string },
): Promise<void> {
  const { error } = await serviceRoleClient
    .from("capture_events")
    .update({
      processing_status: status,
      ...(extra?.errorMessage !== undefined ? { error_message: extra.errorMessage } : {}),
      ...(extra?.promotedCandidateId !== undefined ? { promoted_candidate_id: extra.promotedCandidateId } : {}),
    })
    .eq("id", id);

  if (error) throw error;
}

/**
 * Lists pending/extracted capture events for a user, newest first.
 * Used by the review inbox (Phase 4+).
 */
export async function listPendingCaptureEvents(
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
  limit = 50,
): Promise<CaptureEventRow[]> {
  const { data, error } = await serviceRoleClient
    .from("capture_events")
    .select("*")
    .eq("user_id", userId)
    .in("processing_status", ["pending", "extracted", "promoted"])
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as CaptureEventRow[];
}

// ============================================================
// device_registrations
// ============================================================

/**
 * Upserts a device registration. On conflict (user_id, device_fingerprint),
 * updates the device name, permissions, and last_seen_at. This is called
 * on every successful event POST so the server always has a fresh view of
 * which permissions the device currently has.
 *
 * Returns the upserted row.
 */
export async function upsertDeviceRegistration(
  serviceRoleClient: TypedSupabaseClient,
  input: UpsertDeviceRegistrationInput,
): Promise<DeviceRegistrationRow> {
  const { data, error } = await serviceRoleClient
    .from("device_registrations")
    .upsert(
      {
        user_id: input.userId,
        device_fingerprint: input.deviceFingerprint,
        device_name: input.deviceName ?? "Android Device",
        notification_access_granted: input.notificationAccessGranted ?? false,
        sms_permission_granted: input.smsPermissionGranted ?? false,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,device_fingerprint" },
    )
    .select()
    .single();

  if (error) throw error;
  return data as DeviceRegistrationRow;
}

/**
 * Returns the registration row for a device fingerprint if it exists and
 * has not been revoked. Returns null otherwise.
 */
export async function getActiveDeviceRegistration(
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
  deviceFingerprint: string,
): Promise<DeviceRegistrationRow | null> {
  const { data, error } = await serviceRoleClient
    .from("device_registrations")
    .select("*")
    .eq("user_id", userId)
    .eq("device_fingerprint", deviceFingerprint)
    .is("revoked_at", null)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // no rows
    throw error;
  }
  return data as DeviceRegistrationRow;
}

/**
 * Lists all non-revoked device registrations for a user.
 */
export async function listDeviceRegistrations(
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
): Promise<DeviceRegistrationRow[]> {
  const { data, error } = await serviceRoleClient
    .from("device_registrations")
    .select("*")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as DeviceRegistrationRow[];
}

/**
 * Soft-revokes a device registration (sets revoked_at to now).
 * This prevents the device from submitting new capture events.
 */
export async function revokeDeviceRegistration(
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
  deviceId: string,
): Promise<void> {
  const { error } = await serviceRoleClient
    .from("device_registrations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceId)
    .eq("user_id", userId); // ownership check

  if (error) throw error;
}
