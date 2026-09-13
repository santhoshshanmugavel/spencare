import {
  listNotifications,
  getUnreadNotificationCount,
  listChannelConnections,
  getChannelConnection,
  listNotificationPreferences,
  type NotificationRow,
  type ChannelConnectionRow,
  type NotificationPreferenceRow,
  type NotificationCategory,
} from "@spencare/domain-infra";
import { type AuthContext } from "../types.js";

export interface ListNotificationsOptions {
  category?: NotificationCategory;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listNotificationsQuery(
  ctx: AuthContext,
  options: ListNotificationsOptions = {},
): Promise<NotificationRow[]> {
  return listNotifications(ctx.supabase, ctx.userId, options);
}

export async function getUnreadCountQuery(ctx: AuthContext): Promise<number> {
  return getUnreadNotificationCount(ctx.supabase, ctx.userId);
}

export async function listChannelConnectionsQuery(
  ctx: AuthContext,
): Promise<ChannelConnectionRow[]> {
  return listChannelConnections(ctx.supabase, ctx.userId);
}

export async function getChannelConnectionQuery(
  ctx: AuthContext,
  channel: string,
): Promise<ChannelConnectionRow | null> {
  return getChannelConnection(ctx.supabase, ctx.userId, channel as import("@spencare/domain-infra").NotificationChannel);
}

export async function listNotificationPreferencesQuery(
  ctx: AuthContext,
): Promise<NotificationPreferenceRow[]> {
  return listNotificationPreferences(ctx.supabase, ctx.userId);
}
