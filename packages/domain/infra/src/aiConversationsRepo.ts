import type { TypedSupabaseClient } from "./supabaseClients.js";

/** `ai_conversations` / `ai_messages` (database-architecture.md, Phase 16). Plain RLS-scoped CRUD -- no cross-table balance, no SECURITY DEFINER RPC needed, matching the same "single-table, no atomic requirement" reasoning already used for Budgets/Goals creation. */

export interface AiConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type AiMessageRole = "user" | "assistant" | "tool";

/**
 * `ai_messages.content`'s documented shape (Phase 16 design task,
 * database-architecture.md only says "jsonb, supports structured tool-call/
 * tool-result content"). A discriminated union by `kind`, kept minimal and
 * purposeful per the locked instruction -- no API credentials, no
 * unnecessary financial-data dumps. `text` on an assistant message is
 * always the ALREADY-REDACTED (if Privacy Mode was on at send-time)
 * restatement -- never a second copy of a raw figure.
 */
export type AiMessageContent =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; toolName: string; arguments: Record<string, unknown>; toolCallId: string }
  | { kind: "tool_result"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { kind: "confirmation_reference"; confirmationId: string; commandType: string; preview: Record<string, unknown> }
  | { kind: "error"; message: string }
  | { kind: "provider_metadata"; provider: string; model?: string };

export interface AiMessageRow {
  id: string;
  conversation_id: string;
  role: AiMessageRole;
  content: AiMessageContent;
  created_at: string;
}

export async function createConversation(client: TypedSupabaseClient, userId: string, title: string | null): Promise<AiConversationRow> {
  const { data, error } = await client.from("ai_conversations").insert({ user_id: userId, title }).select().single();
  if (error) throw error;
  return data as AiConversationRow;
}

export async function getConversation(client: TypedSupabaseClient, userId: string, conversationId: string): Promise<AiConversationRow | null> {
  const { data, error } = await client.from("ai_conversations").select().eq("id", conversationId).eq("user_id", userId).is("archived_at", null).maybeSingle();
  if (error) throw error;
  return data as AiConversationRow | null;
}

export async function listConversations(client: TypedSupabaseClient, userId: string): Promise<AiConversationRow[]> {
  const { data, error } = await client
    .from("ai_conversations")
    .select()
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AiConversationRow[];
}

/** Archive, never hard-delete -- matches the `archived_at` model already used for Goals/Accounts, and the locked instruction not to invent hard-delete semantics. */
export async function archiveConversation(client: TypedSupabaseClient, userId: string, conversationId: string): Promise<void> {
  const { error } = await client
    .from("ai_conversations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function touchConversation(client: TypedSupabaseClient, userId: string, conversationId: string): Promise<void> {
  const { error } = await client.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", userId);
  if (error) throw error;
}

export async function insertMessage(client: TypedSupabaseClient, conversationId: string, role: AiMessageRole, content: AiMessageContent): Promise<AiMessageRow> {
  const { data, error } = await client
    .from("ai_messages")
    .insert({ conversation_id: conversationId, role, content: content as never })
    .select()
    .single();
  if (error) throw error;
  return data as AiMessageRow;
}

export async function listMessages(client: TypedSupabaseClient, conversationId: string): Promise<AiMessageRow[]> {
  const { data, error } = await client.from("ai_messages").select().eq("conversation_id", conversationId).order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AiMessageRow[];
}
