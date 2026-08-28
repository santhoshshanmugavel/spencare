import type { TypedSupabaseClient } from "@spencare/domain-infra";

/**
 * api-architecture.md §1's Command/Query contract, first real
 * implementation of the shape Foundation deliberately left unbuilt
 * (packages/domain/application was a .gitkeep until Phase 5).
 *
 * `userId` is derived exclusively from the verified Supabase session by the
 * caller (apps/web's Server Action/Route Handler) -- never accepted as
 * part of a command's `Input` (system model §22, restated api-
 * architecture.md §1). `supabase` is that same session's RLS-scoped
 * client. `serviceRoleSupabase` is used only by the small set of
 * operations that touch a column-level-revoked field
 * (security_settings.totp_secret_encrypted/backup_codes_hash) -- every
 * such operation re-validates `user_id = ctx.userId` explicitly, since RLS
 * does not apply to it.
 */
export interface AuthContext {
  userId: string;
  email: string;
  supabase: TypedSupabaseClient;
  serviceRoleSupabase: TypedSupabaseClient;
}

export type Result<T, E = DomainError> = { ok: true; value: T } | { ok: false; error: E };

export interface DomainError {
  code: string;
  message: string;
}

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends DomainError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export interface Command<Input, Output> {
  name: string;
  /**
   * api-architecture.md §2: true for financial mutations requiring the
   * Section 6a confirmation cascade (createTransaction, updateTransaction,
   * deleteTransaction, transfer, and similarly for Budgets/Goals/Bills
   * once built), false for metadata-only operations (updateProfile,
   * archiveAccount). Transactions (Phase 8) is the first command set in
   * this package to set this true -- Accounts (Phase 7) predates it and
   * is entirely non-consequential per api-architecture.md §2's own
   * classification table.
   *
   * The Web UI satisfies the cascade via `ConsequentialActionPreview`
   * (the form/dialog IS the preview step, per §2: "Web UI may skip step
   * 1's separate round-trip for simple manual entry... the underlying
   * execute function is identical") and the RPC's atomic audit_log write
   * (§4) -- this package does not yet write a `pending_confirmations`
   * row for Web-originated calls the way a future Spensa/MCP entry point
   * would need to; that infrastructure is deferred until an MCP/Spensa
   * consumer actually exists to exercise it (out of Phase 8's scope),
   * documented here rather than silently built or silently dropped.
   */
  consequential: boolean;
  execute: (ctx: AuthContext, input: Input) => Promise<Result<Output>>;
}
