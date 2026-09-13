import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { Json } from "./generated/database.types.js";

export type NotificationSeverity = "info" | "warning" | "critical" | "success";
export type NotificationCategory = "budget" | "goal" | "account" | "bill" | "transaction" | "security" | "report" | "spensa";
export type NotificationChannel = "in_app" | "email" | "telegram" | "slack";
export type DeliveryStatus = "pending" | "delivered" | "failed" | "skipped";

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string | null;
  event_type: string | null;
  severity: NotificationSeverity;
  category: NotificationCategory | null;
  title: string | null;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  financial_context: Record<string, unknown> | null;
  action_url: string | null;
  dedupe_key: string | null;
  expires_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationDeliveryRow {
  id: string;
  notification_id: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  provider_message_id: string | null;
  attempted_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  retry_count: number;
  created_at: string;
}

export interface CreateNotificationInput {
  userId: string;
  eventType: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  financialContext?: Record<string, unknown>;
  actionUrl?: string;
  dedupeKey?: string;
  expiresAt?: string;
}

const NOTIFICATION_COLUMNS =
  "id, user_id, type, event_type, severity, category, title, body, entity_type, entity_id, financial_context, action_url, dedupe_key, expires_at, read_at, created_at";

export async function createNotification(
  client: TypedSupabaseClient,
  input: CreateNotificationInput,
): Promise<NotificationRow | null> {
  const { data, error } = await client
    .from("notifications")
    .upsert(
      {
        user_id: input.userId,
        type: input.eventType,
        event_type: input.eventType,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        financial_context: (input.financialContext ?? null) as Json | null,
        action_url: input.actionUrl ?? null,
        dedupe_key: input.dedupeKey ?? null,
        expires_at: input.expiresAt ?? null,
      },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    )
    .select(NOTIFICATION_COLUMNS)
    .single();

  if (error) {
    // If it was a conflict (dedupe), fetch the existing row
    if (error.code === "23505" || error.message?.includes("duplicate")) return null;
    throw error;
  }
  return data as NotificationRow;
}

export async function listNotifications(
  client: TypedSupabaseClient,
  userId: string,
  options: {
    category?: NotificationCategory;
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<NotificationRow[]> {
  let query = client
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.category) {
    query = query.eq("category", options.category);
  }
  if (options.unreadOnly) {
    query = query.is("read_at", null);
  }
  if (options.offset) {
    query = query.range(options.offset, (options.offset ?? 0) + (options.limit ?? 50) - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function getUnreadNotificationCount(
  client: TypedSupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(
  client: TypedSupabaseClient,
  userId: string,
  notificationId: string,
): Promise<void> {
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) throw error;
}

export async function markAllNotificationsRead(
  client: TypedSupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) throw error;
}

export async function createNotificationDelivery(
  client: TypedSupabaseClient,
  input: {
    notificationId: string;
    channel: NotificationChannel;
    status: DeliveryStatus;
    providerMessageId?: string;
    errorCode?: string;
  },
): Promise<NotificationDeliveryRow | null> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("notification_deliveries")
    .upsert(
      {
        notification_id: input.notificationId,
        channel: input.channel,
        status: input.status,
        provider_message_id: input.providerMessageId ?? null,
        attempted_at: now,
        delivered_at: input.status === "delivered" ? now : null,
        failed_at: input.status === "failed" ? now : null,
        error_code: input.errorCode ?? null,
      },
      { onConflict: "notification_id,channel", ignoreDuplicates: false },
    )
    .select()
    .single();

  if (error) return null;
  return data as NotificationDeliveryRow;
}

export async function updateNotificationDelivery(
  client: TypedSupabaseClient,
  notificationId: string,
  channel: NotificationChannel,
  patch: { status: DeliveryStatus; providerMessageId?: string; errorCode?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from("notification_deliveries")
    .update({
      status: patch.status,
      provider_message_id: patch.providerMessageId ?? null,
      delivered_at: patch.status === "delivered" ? now : null,
      failed_at: patch.status === "failed" ? now : null,
      error_code: patch.errorCode ?? null,
    })
    .eq("notification_id", notificationId)
    .eq("channel", channel);

  if (error) throw error;
}

export async function getNotificationAlertState(
  client: TypedSupabaseClient,
  userId: string,
  entityType: string,
  entityId: string,
  alertType: string,
): Promise<{ lastAlertedat: string; lastValue: number | null } | null> {
  const { data, error } = await client
    .from("notification_alert_state")
    .select("last_alerted_at, last_value")
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("alert_type", alertType)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { lastAlertedat: data.last_alerted_at, lastValue: data.last_value as number | null };
}

export async function upsertNotificationAlertState(
  client: TypedSupabaseClient,
  userId: string,
  entityType: string,
  entityId: string,
  alertType: string,
  lastValue: number | null,
): Promise<void> {
  const { error } = await client
    .from("notification_alert_state")
    .upsert(
      {
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
        alert_type: alertType,
        last_alerted_at: new Date().toISOString(),
        last_value: lastValue,
      },
      { onConflict: "user_id,entity_type,entity_id,alert_type" },
    );

  if (error) throw error;
}

export async function clearNotificationAlertState(
  client: TypedSupabaseClient,
  userId: string,
  entityType: string,
  entityId: string,
  alertType: string,
): Promise<void> {
  const { error } = await client
    .from("notification_alert_state")
    .delete()
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("alert_type", alertType);

  if (error) throw error;
}
