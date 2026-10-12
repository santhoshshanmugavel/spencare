"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { getDecisionInvestigation, type InvestigationQuery } from "@spencare/domain-application";
import { buildInvestigationAiContext, type InvestigationResult } from "@spencare/domain-core";
import { resolveProviderAdapter, NoProviderConfiguredError } from "@spencare/ai";
import type { AuthContext } from "@spencare/domain-application";

export interface InvestigationActionResult {
  data: InvestigationResult | null;
  error: string | null;
}

export interface ExplainActionResult {
  explanation: string | null;
  error: string | null;
}

/**
 * Fetches the investigation result for the given query.
 * Called from the Investigate page when the user changes period or metric.
 */
export async function fetchInvestigation(
  query: InvestigationQuery,
): Promise<InvestigationActionResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "Not authenticated." };

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };

  try {
    const data = await getDecisionInvestigation(ctx, query);
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { data: null, error: message };
  }
}

/**
 * Generates a concise AI explanation for the investigation result.
 * Uses the user's configured AI provider; returns a deterministic fallback
 * summary when no provider is configured or the provider is unavailable.
 */
export async function explainInvestigation(
  result: InvestigationResult,
  privacyMode: boolean,
): Promise<ExplainActionResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { explanation: null, error: "Not authenticated." };

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };

  const context = buildInvestigationAiContext(result, privacyMode);

  const systemPrompt = [
    "You are Spensa, a personal finance assistant for Spencare.",
    "You are helping the user understand why their financial metric changed between two periods.",
    "You will receive structured analysis data. Your job is to explain the observations clearly and honestly.",
    "",
    "Rules:",
    "- Use cautious language: describe merchants or categories as 'contributors to the change', not as causes of the user's financial situation.",
    "- Distinguish verified observations (from the data) from plausible explanations (your inference).",
    "- Do not invent transactions, amounts, or reasons.",
    "- If the data is partial or incomplete, acknowledge that honestly.",
    "- Be concise: 3–5 sentences.",
    "- Do not repeat the raw numbers verbatim; synthesise them into a readable observation.",
    privacyMode ? "- Financial amounts are redacted for privacy. Do not speculate about amounts." : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const adapter = await resolveProviderAdapter(ctx);
    let text = "";
    for await (const event of adapter.chat(
      [{ role: "user", content: context }],
      [],
      systemPrompt,
    )) {
      if (event.type === "text_delta") text += event.text;
    }
    return { explanation: text.trim() || null, error: null };
  } catch (err) {
    if (err instanceof NoProviderConfiguredError) {
      // Deterministic fallback when no AI provider is configured.
      return {
        explanation: buildDeterministicSummary(result, privacyMode),
        error: null,
      };
    }
    const message = err instanceof Error ? err.message : "AI explanation unavailable.";
    return { explanation: buildDeterministicSummary(result, privacyMode), error: message };
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallback summary (no AI required)
// ---------------------------------------------------------------------------

function buildDeterministicSummary(
  result: InvestigationResult,
  privacyMode: boolean,
): string {
  const { metric, categoryContributors, investigatedMetric } = result;
  const metricLabels: Record<string, string> = {
    total_expenses: "spending",
    total_income: "income",
    net_cash_movement: "net cash movement",
  };
  const metricLabel = metricLabels[investigatedMetric] ?? investigatedMetric;

  const direction = metric.absoluteDiff > 0 ? "increased" : metric.absoluteDiff < 0 ? "decreased" : "remained unchanged";

  const top = categoryContributors[0];
  const topLine =
    top && top.absoluteChangeMinor !== 0
      ? ` ${top.label} was the largest contributor${privacyMode ? "" : ""}.`
      : "";

  const partialNote = metric.isPartialPeriod
    ? " The current period is still in progress, so figures will continue to change."
    : "";

  const limitationsNote =
    result.limitations.length > 0 ? ` Note: ${result.limitations[0]}` : "";

  return `Your ${metricLabel} ${direction} compared to the previous period.${topLine}${partialNote}${limitationsNote}`;
}
