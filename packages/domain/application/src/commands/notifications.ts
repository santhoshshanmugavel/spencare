import {
  markNotificationRead as markRead,
  markAllNotificationsRead as markAllRead,
  upsertNotificationPreference,
  disconnectChannel,
  createTelegramLinkToken as createToken,
  type NotificationChannel,
  type UpsertPreferenceInput,
} from "@spencare/domain-infra";
import { type AuthContext } from "../types.js";

// ---- Read/unread ----

export async function markNotificationRead(
  ctx: AuthContext,
  notificationId: string,
): Promise<void> {
  await markRead(ctx.supabase, ctx.userId, notificationId);
}

export async function markAllNotificationsRead(ctx: AuthContext): Promise<void> {
  await markAllRead(ctx.supabase, ctx.userId);
}

// ---- Preferences ----

export async function saveNotificationPreference(
  ctx: AuthContext,
  input: Omit<UpsertPreferenceInput, "userId">,
): Promise<void> {
  await upsertNotificationPreference(ctx.supabase, { ...input, userId: ctx.userId });
}

// ---- Channel management ----

export async function disconnectNotificationChannel(
  ctx: AuthContext,
  channel: NotificationChannel,
): Promise<void> {
  await disconnectChannel(ctx.supabase, ctx.userId, channel);
}

/**
 * Generate a one-time Telegram link token.
 * The token is shown to the user who sends it to @Spencare_bot.
 * The bot webhook resolves it and stores the encrypted chat_id server-side.
 */
export async function generateTelegramLinkToken(ctx: AuthContext): Promise<string> {
  return createToken(ctx.supabase, ctx.userId);
}
