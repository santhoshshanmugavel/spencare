import {
  callConfirmCommand,
  cancelConfirmation,
  getPendingConfirmation,
  proposeConfirmation,
} from "@spencare/domain-infra";
import type { AuthContext } from "@spencare/domain-application";
import type { ConfirmationCommandType } from "@spencare/validation";
import { describeAmountForProvider } from "@spencare/domain-core";

/** Bounded, non-negotiable expiry -- api-architecture.md §3: "the confirmation expires". 10 minutes gives a real chat conversation room to pause and come back without leaving a proposal open indefinitely. */
const CONFIRMATION_EXPIRY_MS = 10 * 60 * 1000;

export interface ProposalPreviewField {
  label: string;
  value: string;
}

export interface ProposalResult {
  confirmationId: string;
  summary: string;
  fields: ProposalPreviewField[];
  expiresAt: string;
}

/**
 * `proposeCommand` (api-architecture.md §2). A plain authenticated insert
 * into `pending_confirmations` -- no RPC needed, since that table already
 * has full "own row" RLS (Foundation). The preview text is built here from
 * data the caller ALREADY validated/fetched (never a second financial
 * calculation) -- describing WHAT will happen structurally, never
 * projecting a numeric before/after Safe-to-Spend (that would require
 * simulating the mutation, which risks silently drifting from what
 * confirmCommand actually does).
 *
 * `privacyModeEnabled` governs whether the preview's own amount text is
 * redacted -- the SAME narrow mitigation applied to AiContext, applied
 * here too, since a proposal's summary could otherwise be the one place a
 * real figure leaks into a provider-bound message (e.g. Spensa restating
 * the proposal back to the user in its own reply).
 */
export async function proposeCommand(
  ctx: AuthContext,
  commandType: ConfirmationCommandType,
  payload: Record<string, unknown>,
  preview: { summary: string; fields: ProposalPreviewField[] },
): Promise<ProposalResult> {
  const row = await proposeConfirmation(ctx.supabase, ctx.userId, {
    source: "spensa",
    commandType,
    payload,
    preview: preview as unknown as Record<string, unknown>,
    expiresInMs: CONFIRMATION_EXPIRY_MS,
  });
  return {
    confirmationId: row.id,
    summary: preview.summary,
    fields: preview.fields,
    expiresAt: row.expires_at,
  };
}

export interface ConfirmResult {
  ok: true;
  result: Record<string, unknown>;
}
export interface ConfirmError {
  ok: false;
  error: { code: string; message: string };
}

const CONFIRM_ERROR_MESSAGES: Record<string, string> = {
  confirmation_not_found: "That proposal wasn't found, or belongs to someone else.",
  confirmation_not_pending: "That proposal was already confirmed, cancelled, or has expired.",
  confirmation_expired: "That proposal has expired. Ask Spensa to propose it again.",
  not_authorized: "You're not authorized to confirm that proposal.",
};

/**
 * `confirmCommand` (api-architecture.md §2-3). Re-validates ownership,
 * status, and expiry, executes the underlying mutation, and flips the
 * confirmation to `confirmed` -- all inside ONE atomic Postgres
 * transaction (the `confirm_command` RPC), so a failed mutation can never
 * leave a confirmation stranded at `confirmed` with nothing having
 * actually happened, and a concurrent double-confirm can never
 * double-execute (see the migration's own extensive comment for the full
 * locking rationale).
 */
export async function confirmCommand(ctx: AuthContext, confirmationId: string): Promise<ConfirmResult | ConfirmError> {
  try {
    const result = await callConfirmCommand(ctx.supabase, ctx.userId, confirmationId, "spensa");
    return { ok: true, result };
  } catch (err) {
    const code = extractErrorCode(err);
    return { ok: false, error: { code, message: CONFIRM_ERROR_MESSAGES[code] ?? "Could not confirm that action." } };
  }
}

export async function cancelPendingCommand(ctx: AuthContext, confirmationId: string): Promise<void> {
  await cancelConfirmation(ctx.supabase, ctx.userId, confirmationId);
}

export async function getProposal(ctx: AuthContext, confirmationId: string) {
  return getPendingConfirmation(ctx.supabase, ctx.userId, confirmationId);
}

/** Supabase/PostgREST RPC errors are plain {code, details, hint, message} objects, never real Error instances -- same shape-safe extraction established since Phase 11. */
function extractErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const maybeMessage = "message" in err ? String((err as { message: unknown }).message) : "";
    for (const code of Object.keys(CONFIRM_ERROR_MESSAGES)) {
      if (maybeMessage.includes(code)) return code;
    }
  }
  return "unknown_error";
}

export { describeAmountForProvider };
