import {
  callConfirmCommand,
  cancelConfirmation,
  getPendingConfirmation,
  proposeConfirmation,
  type ConfirmationSource,
} from "@spencare/domain-infra";
import type { ConfirmationCommandType } from "@spencare/validation";
import { describeAmountForProvider } from "@spencare/domain-core";
import type { AuthContext } from "../types.js";

/**
 * The canonical propose/confirm confirmation cascade (api-architecture.md
 * §2-3; ADR-0007). MOVED HERE from `packages/ai` during Phase 18 (MCP
 * Integration), locked decision #2: `apps/mcp-server` may depend on
 * `packages/domain/application` and nothing above it (mcp-architecture.md
 * §1's own layering diagram excludes `packages/ai` entirely), so the one
 * generic confirmation mechanism both Spensa and MCP must share can only
 * live here, not in `packages/ai` where Phase 16 originally placed it.
 *
 * `packages/ai/src/confirmation.ts` is now a thin re-export of this module
 * -- there is exactly ONE implementation, never two. Nothing about the
 * mechanism itself changed: still a plain authenticated insert for
 * propose (the table's own RLS already scopes it), still the atomic
 * `confirm_command` SECURITY DEFINER RPC for confirm, still single-use,
 * expiring, ownership-scoped, and stale-state-aware exactly as Phase 16
 * built and `security_smoke.sh` already proves (130+ passing checks,
 * unaffected by this relocation since the underlying RPC/table/RLS never
 * changed).
 */

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
 * `proposeCommand`. `source` is REQUIRED, never defaulted -- Phase 18's
 * locked rule is that the confirmation source/audit actor must always be
 * the caller's own real identity ("mcp" for MCP, "spensa" for Spensa),
 * never silently inherited from a repo-layer default a caller forgot to
 * override. `privacyModeEnabled` governs whether the preview's own amount
 * text is redacted (the same narrow mitigation applied to AiContext in
 * Phase 16) -- a proposal's summary could otherwise be the one place a
 * real figure leaks into a provider-bound message, and now, since MCP is
 * also an external boundary, the one place it leaks to an external MCP
 * client too.
 */
export async function proposeCommand(
  ctx: AuthContext,
  source: ConfirmationSource,
  commandType: ConfirmationCommandType,
  payload: Record<string, unknown>,
  preview: { summary: string; fields: ProposalPreviewField[] },
): Promise<ProposalResult> {
  const row = await proposeConfirmation(ctx.supabase, ctx.userId, {
    source,
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
  confirmation_expired: "That proposal has expired. Ask again to propose it a new one.",
  not_authorized: "You're not authorized to confirm that proposal.",
};

/**
 * `confirmCommand`. `actor` is REQUIRED, matching `proposeCommand`'s
 * `source` -- the caller (Spensa or MCP) must always pass its own real
 * identity, never rely on a default.
 */
export async function confirmCommand(ctx: AuthContext, confirmationId: string, actor: ConfirmationSource): Promise<ConfirmResult | ConfirmError> {
  try {
    const result = await callConfirmCommand(ctx.supabase, ctx.userId, confirmationId, actor);
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
