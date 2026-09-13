import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { NotificationChannel } from "./notificationsRepo.js";

export interface NotificationPreferenceRow {
  id: string;
  user_id: string;
  event_type: string | null;
  channel: NotificationChannel;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertPreferenceInput {
  userId: string;
  channel: NotificationChannel;
  eventType?: string | null;
  enabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

const COLUMNS = "id, user_id, event_type, channel, enabled, quiet_hours_start, quiet_hours_end, created_at, updated_at";

export async function listNotificationPreferences(
  client: TypedSupabaseClient,
  userId: string,
): Promise<NotificationPreferenceRow[]> {
  const { data, error } = await client
    .from("notification_preferences")
    .select(COLUMNS)
    .eq("user_id", userId);

  if (error) throw error;
  return (data ?? []) as NotificationPreferenceRow[];
}

export async function upsertNotificationPreference(
  client: TypedSupabaseClient,
  input: UpsertPreferenceInput,
): Promise<NotificationPreferenceRow> {
  const { data, error } = await client
    .from("notification_preferences")
    .upsert(
      {
        user_id: input.userId,
        channel: input.channel,
        event_type: input.eventType ?? null,
        enabled: input.enabled,
        quiet_hours_start: input.quietHoursStart ?? null,
        quiet_hours_end: input.quietHoursEnd ?? null,
      },
      { onConflict: "user_id,channel,event_type" },
    )
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as NotificationPreferenceRow;
}

export function isChannelEnabled(
  preferences: NotificationPreferenceRow[],
  channel: NotificationChannel,
): boolean {
  const globalPref = preferences.find(
    (p) => p.channel === channel && p.event_type === null,
  );
  // Default: email and in_app are enabled, telegram/slack need explicit connection
  if (!globalPref) {
    return channel === "email" || channel === "in_app";
  }
  return globalPref.enabled;
}

export function isEventTypeEnabled(
  preferences: NotificationPreferenceRow[],
  channel: NotificationChannel,
  eventType: string,
): boolean {
  if (!isChannelEnabled(preferences, channel)) return false;
  const specific = preferences.find(
    (p) => p.channel === channel && p.event_type === eventType,
  );
  // Default enabled if no specific preference
  return specific ? specific.enabled : true;
}

export function getQuietHours(
  preferences: NotificationPreferenceRow[],
  channel: NotificationChannel,
): { start: string; end: string } | null {
  const pref = preferences.find(
    (p) => p.channel === channel && p.event_type === null,
  );
  if (!pref?.quiet_hours_start || !pref?.quiet_hours_end) return null;
  return { start: pref.quiet_hours_start, end: pref.quiet_hours_end };
}

/** Check if current time is within quiet hours. Returns true if quiet hours are active. */
export function isQuietHoursActive(quietHours: { start: string; end: string } | null): boolean {
  if (!quietHours) return false;

  const now = new Date();
  const startParts = quietHours.start.split(":");
  const endParts = quietHours.end.split(":");
  const startH = Number(startParts[0] ?? 0);
  const startM = Number(startParts[1] ?? 0);
  const endH = Number(endParts[0] ?? 0);
  const endM = Number(endParts[1] ?? 0);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same day: e.g. 09:00 to 18:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight: e.g. 22:00 to 07:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
