import type { AuthContext } from "@spencare/domain-application";
import {
  archiveConversation,
  getConversation as getConversationRow,
  listConversations as listConversationsRows,
  listMessages,
  type AiConversationRow,
  type AiMessageRow,
} from "@spencare/domain-infra";
// (listMessages retained for getConversationMessages below)
import { regenerateReplySchema, type RegenerateReplyInput } from "@spencare/validation";
import { sendMessage, type OrchestratorEvent, type SendMessageOptions } from "./orchestrator.js";

/**
 * `getConversation`/`listConversations` (domain-architecture.md §13).
 * Deliberately exposed from `packages/ai`, not `packages/domain/
 * application` -- ai-architecture.md §1's own layering diagram places "AI
 * Orchestration" above "Domain Operations (packages/domain/application)",
 * and these two queries are purely AI/Spensa-specific (no other domain
 * consumes `ai_conversations`), so they live alongside the orchestrator
 * rather than in the shared application layer other domains also depend
 * on -- avoiding a circular package dependency (packages/ai already
 * depends on domain-application for tool execution; the reverse would be
 * required if these lived there instead). Documented here explicitly
 * since it's a deliberate placement decision, not an oversight.
 */
export async function getConversation(ctx: AuthContext, conversationId: string): Promise<AiConversationRow | null> {
  return getConversationRow(ctx.supabase, ctx.userId, conversationId);
}

export async function listConversations(ctx: AuthContext): Promise<AiConversationRow[]> {
  return listConversationsRows(ctx.supabase, ctx.userId);
}

export async function getConversationMessages(ctx: AuthContext, conversationId: string): Promise<AiMessageRow[]> {
  const conversation = await getConversationRow(ctx.supabase, ctx.userId, conversationId);
  if (!conversation) return [];
  return listMessages(ctx.supabase, conversationId);
}

export async function deleteConversation(ctx: AuthContext, conversationId: string): Promise<void> {
  await archiveConversation(ctx.supabase, ctx.userId, conversationId);
}

/**
 * `regenerateReply` (domain-architecture.md §13). `regenerateReplySchema`
 * requires `messageId` -- the specific assistant message being regenerated
 * (the "regenerate" control on ANY of the conversation's replies, not just
 * the latest one, per the AI insight card affordance in
 * component-inventory.md §21). This locates that message, finds the user
 * turn that immediately preceded it, and re-runs the orchestrator from
 * there with a fresh AiContext -- never re-inserting a second copy of that
 * user message (see `skipUserMessageInsert` on `sendMessage`).
 */
export async function* regenerateReply(ctx: AuthContext, rawInput: RegenerateReplyInput, options: SendMessageOptions = {}): AsyncGenerator<OrchestratorEvent> {
  const input = regenerateReplySchema.parse(rawInput);
  // getConversationMessages re-checks ownership (returns [] for a
  // conversation that isn't the caller's) before ever reading its
  // messages -- never trust `input.conversationId` alone.
  const messages = await getConversationMessages(ctx, input.conversationId);
  const targetIndex = messages.findIndex((m) => m.id === input.messageId);
  if (targetIndex === -1) {
    yield { type: "error", message: "That message wasn't found in this conversation." };
    return;
  }
  const priorUserMessage = [...messages.slice(0, targetIndex)].reverse().find((m) => m.role === "user" && m.content.kind === "text");
  if (!priorUserMessage || priorUserMessage.content.kind !== "text") {
    yield { type: "error", message: "Nothing to regenerate -- no prior user message found." };
    return;
  }
  // skipUserMessageInsert: true -- the user's message is already persisted
  // (it's the one we just found and are replaying); regenerating must
  // never duplicate it in the transcript.
  yield* sendMessage(ctx, { conversationId: input.conversationId, content: priorUserMessage.content.text }, { ...options, skipUserMessageInsert: true });
}
