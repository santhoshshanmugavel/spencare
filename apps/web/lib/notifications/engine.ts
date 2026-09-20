/**
 * Notification delivery engine.
 *
 * Knows how to take a notification row and fan it out to each enabled
 * channel the user has configured. Financial values are computed by the
 * caller (rules layer) — this module only delivers.
 */

import {
  createNotification,
  createNotificationDelivery,
  updateNotificationDelivery,
  listNotificationPreferences,
  getChannelConnectionMetadata,
  isChannelEnabled,
  isEventTypeEnabled,
  isQuietHoursActive,
  getQuietHours,
  type CreateNotificationInput,
} from "@spencare/domain-infra";
import { composeNotificationMessage, type NotificationEventType } from "@spencare/domain-application";
import type { TypedSupabaseClient } from "@spencare/domain-infra";
import { sendNotificationEmail } from "./emailProvider";
import { sendTelegramMessage } from "./telegramProvider";

function getEncryptionKey(): string {
  const key = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!key) throw new Error("CHANNEL_ENCRYPTION_KEY is not configured.");
  return key;
}

export interface DeliverNotificationInput {
  userId: string;
  userEmail: string;
  eventType: NotificationEventType;
  financialContext: Record<string, unknown>;
  category: CreateNotificationInput["category"];
  severity: CreateNotificationInput["severity"];
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  dedupeKey?: string;
  expiresAt?: string;
}

/**
 * The main entry point for delivering a notification to a user.
 * 1. Compose the Spensa message.
 * 2. Create the notification row (idempotent via dedupe_key).
 * 3. Check preferences for each channel.
 * 4. Deliver and record delivery status.
 */
export async function deliverNotification(
  serviceRoleSupabase: TypedSupabaseClient,
  input: DeliverNotificationInput,
): Promise<{ notificationId: string | null; channels: string[] }> {
  const message = composeNotificationMessage(input.eventType, input.financialContext);

  // Create notification row
  const notification = await createNotification(serviceRoleSupabase, {
    userId: input.userId,
    eventType: input.eventType,
    severity: input.severity,
    category: input.category,
    title: message.title,
    body: message.body,
    entityType: input.entityType,
    entityId: input.entityId,
    financialContext: input.financialContext,
    actionUrl: input.actionUrl,
    dedupeKey: input.dedupeKey,
    expiresAt: input.expiresAt,
  });

  // Dedupe: notification already existed
  if (!notification) return { notificationId: null, channels: [] };

  const notificationId = notification.id;

  // Load preferences
  const preferences = await listNotificationPreferences(serviceRoleSupabase, input.userId);

  const deliveredChannels: string[] = [];

  // in_app is always created (the row is the delivery) — mark delivered immediately
  if (isEventTypeEnabled(preferences, "in_app", input.eventType)) {
    await createNotificationDelivery(serviceRoleSupabase, {
      notificationId,
      channel: "in_app",
      status: "delivered",
    });
    deliveredChannels.push("in_app");
  }

  // email — disabled until email delivery is production-ready
  // Re-enable by setting EMAIL_CHANNEL_ENABLED=true in Vercel env
  const emailEnabled = process.env.EMAIL_CHANNEL_ENABLED === "true";
  if (
    emailEnabled &&
    isEventTypeEnabled(preferences, "email", input.eventType) &&
    !isQuietHoursActive(getQuietHours(preferences, "email"))
  ) {
    const del = await createNotificationDelivery(serviceRoleSupabase, {
      notificationId,
      channel: "email",
      status: "pending",
    });

    const result = await sendNotificationEmail({
      to: input.userEmail,
      title: message.title,
      body: message.body,
      actionUrl: input.actionUrl,
    });

    if (del) {
      await updateNotificationDelivery(serviceRoleSupabase, notificationId, "email", {
        status: result.ok ? "delivered" : "failed",
        providerMessageId: result.messageId,
        errorCode: result.error,
      });
    }

    if (result.ok) deliveredChannels.push("email");
  }

  // telegram
  if (
    isChannelEnabled(preferences, "telegram") &&
    isEventTypeEnabled(preferences, "telegram", input.eventType) &&
    !isQuietHoursActive(getQuietHours(preferences, "telegram"))
  ) {
    try {
      const meta = await getChannelConnectionMetadata<{ chat_id: string }>(
        serviceRoleSupabase,
        input.userId,
        "telegram",
        getEncryptionKey(),
      );

      if (meta?.chat_id) {
        const del = await createNotificationDelivery(serviceRoleSupabase, {
          notificationId,
          channel: "telegram",
          status: "pending",
        });

        const telegramText = message.telegramBody ?? `<b>${message.title}</b>\n\n${message.body}`;
        const result = await sendTelegramMessage(meta.chat_id, telegramText);

        if (del) {
          await updateNotificationDelivery(serviceRoleSupabase, notificationId, "telegram", {
            status: result.ok ? "delivered" : "failed",
            providerMessageId: result.messageId?.toString(),
            errorCode: result.error,
          });
        }

        if (result.ok) deliveredChannels.push("telegram");
      }
    } catch (err) {
      // Telegram delivery errors must not interrupt the engine
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[notifications/engine] Telegram delivery skipped:", msg);
    }
  }

  return { notificationId, channels: deliveredChannels };
}
