import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./crypto.js";
import type { TypedSupabaseClient } from "./supabaseClients.js";
import type { NotificationChannel } from "./notificationsRepo.js";

export type ChannelConnectionStatus = "connected" | "disconnected";

export interface ChannelConnectionRow {
  id: string;
  user_id: string;
  channel: NotificationChannel;
  status: ChannelConnectionStatus;
  display_name: string | null;
  connected_at: string;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Encrypted metadata shapes per channel */
export interface TelegramMetadata {
  chat_id: string;
  first_name: string;
  username?: string;
}

export interface SlackMetadata {
  access_token: string;
  team_id: string;
  team_name: string;
  channel_id: string;
  channel_name: string;
  bot_user_id: string;
}

const SAFE_COLUMNS = "id, user_id, channel, status, display_name, connected_at, disconnected_at, created_at, updated_at";

export async function getChannelConnection(
  client: TypedSupabaseClient,
  userId: string,
  channel: NotificationChannel,
): Promise<ChannelConnectionRow | null> {
  const { data, error } = await client
    .from("channel_connections")
    .select(SAFE_COLUMNS)
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw error;
  return data as ChannelConnectionRow | null;
}

export async function listChannelConnections(
  client: TypedSupabaseClient,
  userId: string,
): Promise<ChannelConnectionRow[]> {
  const { data, error } = await client
    .from("channel_connections")
    .select(SAFE_COLUMNS)
    .eq("user_id", userId)
    .order("channel");

  if (error) throw error;
  return (data ?? []) as ChannelConnectionRow[];
}

/** Service-role only — saves encrypted metadata. Never call from browser. */
export async function saveChannelConnection(
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
  channel: NotificationChannel,
  metadata: TelegramMetadata | SlackMetadata,
  displayName: string,
  encryptionKeyHex: string,
): Promise<ChannelConnectionRow> {
  const plaintext = JSON.stringify(metadata);
  const encrypted = encryptSecret(plaintext, encryptionKeyHex);

  const { data, error } = await serviceRoleClient
    .from("channel_connections")
    .upsert(
      {
        user_id: userId,
        channel: channel,
        status: "connected" as const,
        encrypted_metadata: `\\x${encrypted.toString("hex")}`,
        display_name: displayName,
        connected_at: new Date().toISOString(),
        disconnected_at: null,
      },
      { onConflict: "user_id,channel" },
    )
    .select(SAFE_COLUMNS)
    .single();

  if (error) throw error;
  return data as ChannelConnectionRow;
}

/** Service-role only — reads encrypted metadata. Never call from browser. */
export async function getChannelConnectionMetadata<T = TelegramMetadata | SlackMetadata>(
  serviceRoleClient: TypedSupabaseClient,
  userId: string,
  channel: NotificationChannel,
  encryptionKeyHex: string,
): Promise<T | null> {
  const { data, error } = await serviceRoleClient
    .from("channel_connections")
    .select("encrypted_metadata")
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw error;
  if (!data?.encrypted_metadata) return null;

  const hex = (data.encrypted_metadata as unknown as string).replace(/^\\x/, "");
  const buf = Buffer.from(hex, "hex");
  const plain = decryptSecret(buf, encryptionKeyHex);
  return JSON.parse(plain) as T;
}

/** Service-role only — get all connected telegram chat_ids for delivery fan-out */
export async function getAllTelegramConnections(
  serviceRoleClient: TypedSupabaseClient,
  encryptionKeyHex: string,
): Promise<Array<{ userId: string; chatId: string }>> {
  const { data, error } = await serviceRoleClient
    .from("channel_connections")
    .select("user_id, encrypted_metadata")
    .eq("channel", "telegram")
    .eq("status", "connected");

  if (error) throw error;

  const results: Array<{ userId: string; chatId: string }> = [];
  for (const row of data ?? []) {
    try {
      if (!row.encrypted_metadata) continue;
      const hex = (row.encrypted_metadata as unknown as string).replace(/^\\x/, "");
      const buf = Buffer.from(hex, "hex");
      const plain = decryptSecret(buf, encryptionKeyHex);
      const meta = JSON.parse(plain) as TelegramMetadata;
      results.push({ userId: row.user_id, chatId: meta.chat_id });
    } catch {
      // Skip rows with decryption errors
    }
  }
  return results;
}

export async function disconnectChannel(
  client: TypedSupabaseClient,
  userId: string,
  channel: NotificationChannel,
): Promise<void> {
  const { error } = await client
    .from("channel_connections")
    .update({
      status: "disconnected",
      disconnected_at: new Date().toISOString(),
      encrypted_metadata: null,
    })
    .eq("user_id", userId)
    .eq("channel", channel);

  if (error) throw error;
}

// ============================================================
// Telegram link tokens
// ============================================================

export interface TelegramLinkToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  used_at: string | null;
}

export async function createTelegramLinkToken(
  client: TypedSupabaseClient,
  userId: string,
): Promise<string> {
  // Invalidate any existing unused tokens for this user
  await client
    .from("telegram_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("used_at", null);

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

  const { error } = await client
    .from("telegram_link_tokens")
    .insert({ user_id: userId, token, expires_at: expiresAt });

  if (error) throw error;
  return token;
}

export async function resolveTelegramLinkToken(
  serviceRoleClient: TypedSupabaseClient,
  token: string,
): Promise<string | null> {
  const { data, error } = await serviceRoleClient
    .from("telegram_link_tokens")
    .select("id, user_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.used_at) return null; // Already used
  if (new Date(data.expires_at) < new Date()) return null; // Expired

  // Mark as used
  await serviceRoleClient
    .from("telegram_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);

  return data.user_id;
}
