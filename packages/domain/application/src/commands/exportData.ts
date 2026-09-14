import { listConversations, listMessages, type AiConversationRow } from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";
import { getProfile } from "../queries/getProfile.js";
import { listAccounts } from "../queries/accounts.js";
import { listTransactions } from "../queries/transactions.js";
import { listBudgets } from "../queries/budgets.js";
import { listGoals } from "../queries/goals.js";
import { listBillPredictions } from "../queries/bills.js";
import { listGoalContributionPlans } from "../queries/goalContributionPlans.js";

/**
 * Personal-data export (Phase 20, "Data & Backup" -- SP-320's checklist:
 * "Accounts and balances; Transactions and history; Budgets and goals;
 * AI conversations and insights"). Bills and Profile are included as a
 * disclosed, reasonable extension of that checklist -- excluding your own
 * profile or your bill predictions from an "export MY data" bundle would
 * be an indefensible gap, not a scope reduction.
 *
 * DELIBERATE, DISCLOSED DEVIATION FROM THE VISUAL DESIGN: SP-320/SP-318
 * show an ASYNCHRONOUS flow ("Spensa AI will prepare your CSV file and
 * send a download link to your email in 5-6 days" / conflicting "~24
 * hours" -- see visual-conflicts.md CF-D13, never resolved either way).
 * That flow requires a background-job scheduler and transactional email
 * delivery, neither of which exists anywhere in this deployment (the
 * same documented gap Phase 19 found for Gmail sync). Per this phase's
 * own instruction ("choose the smallest safe implementation consistent
 * with existing architecture"), this export is SYNCHRONOUS: generated
 * in the same request and returned directly, never a fabricated
 * "check your email in N days" promise this codebase cannot keep.
 *
 * NEVER included (explicit exclusion list, not an oversight): password
 * hashes, `security_settings.totp_secret_encrypted`/`backup_codes_hash`,
 * `ai_provider_credentials.encrypted_api_key`, `gmail_connections.
 * encrypted_refresh_token`, `mcp_sessions.token_hash`, any Supabase
 * service-role material, raw Gmail email bodies (never durably stored in
 * the first place -- see Phase 19's gmail_financial_candidates design).
 */

export interface ExportBundle {
  exportedAt: string;
  profile: Record<string, unknown> | null;
  accounts: unknown[];
  transactions: unknown[];
  budgets: unknown[];
  goals: unknown[];
  goalContributionPlans: unknown[];
  bills: unknown[];
  aiConversations: { conversation: AiConversationRow; messages: unknown[] }[];
}

export async function exportUserData(ctx: AuthContext): Promise<ExportBundle> {
  const [profile, accounts, transactions, budgets, goals, goalContributionPlans, bills, conversations] = await Promise.all([
    getProfile(ctx),
    listAccounts(ctx, {}),
    listTransactions(ctx, {}),
    listBudgets(ctx, {}),
    listGoals(ctx, {}),
    listGoalContributionPlans(ctx),
    listBillPredictions(ctx, {}),
    listConversations(ctx.supabase, ctx.userId),
  ]);

  const aiConversations = await Promise.all(
    conversations.map(async (conversation) => ({
      conversation,
      messages: await listMessages(ctx.supabase, conversation.id),
    })),
  );

  return {
    exportedAt: new Date().toISOString(),
    profile: profile as unknown as Record<string, unknown> | null,
    accounts,
    transactions,
    budgets,
    goals,
    goalContributionPlans,
    bills,
    aiConversations,
  };
}
