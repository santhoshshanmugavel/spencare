import { calculateGoalProgress, type GoalProgress } from "@spencare/domain-core";
import {
  getGoal as getGoalRow,
  getGoalImageSignedUrl,
  listContributions as listContributionsRow,
  listGoals as listGoalsRow,
  type GoalRow,
  type ListGoalsOptions,
  type TransactionRow,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export async function listGoals(ctx: AuthContext, options: ListGoalsOptions = {}): Promise<GoalRow[]> {
  return listGoalsRow(ctx.supabase, ctx.userId, options);
}

export async function getGoal(ctx: AuthContext, goalId: string): Promise<GoalRow | null> {
  return getGoalRow(ctx.supabase, ctx.userId, goalId);
}

/** api-architecture.md §12 / domain-architecture.md §7's exact query name. Thin wrapper: fetches the one goal, then the pure `calculateGoalProgress` (Phase 11 domain-core) does all the arithmetic. */
export async function calculateProgress(ctx: AuthContext, goalId: string): Promise<GoalProgress | null> {
  const goal = await getGoalRow(ctx.supabase, ctx.userId, goalId);
  if (!goal) return null;
  return calculateGoalProgress(goal.target_amount_minor, goal.saved_amount_minor, goal.target_date);
}

/** SP-195/196's "Contributions" ledger -- reads the existing transactions table, no new storage. */
export async function listContributions(ctx: AuthContext, goalId: string): Promise<TransactionRow[]> {
  return listContributionsRow(ctx.supabase, ctx.userId, goalId);
}

/**
 * Resolves a goal's stored private Storage path (`goals.image_url`) into
 * a fresh, short-lived signed URL -- the exact same pattern as
 * `getProfileForDisplay.ts`'s avatar resolution, deliberately kept OUT of
 * `GoalRow` itself so every other consumer of goals (Safe-to-Spend,
 * cash-flow, MCP tools, the domain-core progress calculation) stays
 * completely unaware images exist. Failures resolve to `null` rather than
 * throwing -- a goal with a since-removed or unreadable image object
 * should render as if it had none, not break the page.
 */
export async function resolveGoalImageUrl(ctx: AuthContext, imagePath: string): Promise<string | null> {
  try {
    return await getGoalImageSignedUrl(ctx.supabase, imagePath);
  } catch {
    return null;
  }
}

/** Batched form of `resolveGoalImageUrl` for a full goal list -- one entry per goal that HAS an image, keyed by goal id. */
export async function resolveGoalImageUrls(ctx: AuthContext, goals: GoalRow[]): Promise<Record<string, string>> {
  const withImages = goals.filter((g): g is GoalRow & { image_url: string } => !!g.image_url);
  const entries = await Promise.all(
    withImages.map(async (g) => [g.id, await resolveGoalImageUrl(ctx, g.image_url)] as const),
  );
  const map: Record<string, string> = {};
  for (const [id, url] of entries) {
    if (url) map[id] = url;
  }
  return map;
}
