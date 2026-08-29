"use server";

import { revalidatePath } from "next/cache";
import { confirmCommand, cancelPendingCommand, listConversations, getConversation, getConversationMessages, deleteConversation, regenerateReply } from "@spencare/ai";
import type { AuthContext } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every Spensa action resolves AuthContext from the verified session -- never a client-supplied user id, same pattern as every prior phase. */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

/**
 * The ONLY server-side action that can turn a proposal into a real
 * mutation -- called exclusively from an explicit user click on
 * ConsequentialActionPreview's Confirm button. Never called automatically,
 * never inferred from message content (locked decision §7).
 */
export async function confirmCommandAction(confirmationId: string) {
  const ctx = await requireAuthContext();
  const result = await confirmCommand(ctx, confirmationId);
  if (result.ok) {
    revalidatePath("/cash-flow");
    revalidatePath("/goals");
    revalidatePath("/home");
  }
  return result;
}

export async function cancelCommandAction(confirmationId: string) {
  const ctx = await requireAuthContext();
  await cancelPendingCommand(ctx, confirmationId);
}

export async function listConversationsAction() {
  const ctx = await requireAuthContext();
  return listConversations(ctx);
}

export async function getConversationAction(conversationId: string) {
  const ctx = await requireAuthContext();
  const [conversation, messages] = await Promise.all([getConversation(ctx, conversationId), getConversationMessages(ctx, conversationId)]);
  return { conversation, messages };
}

export async function deleteConversationAction(conversationId: string) {
  const ctx = await requireAuthContext();
  await deleteConversation(ctx, conversationId);
  revalidatePath("/spensa");
}

/**
 * `regenerateReply` (domain-architecture.md §13) exposed as a plain,
 * non-streaming action -- the AI insight card's "regenerate" affordance
 * (component-inventory.md §21) reuses the same command; streaming a
 * regeneration isn't required by any locked decision, so this keeps the
 * simplest shape that still refreshes the conversation for the caller.
 */
export async function regenerateReplyAction(conversationId: string, messageId: string) {
  const ctx = await requireAuthContext();
  const events = [];
  for await (const event of regenerateReply(ctx, { conversationId, messageId })) {
    events.push(event);
  }
  return events;
}
