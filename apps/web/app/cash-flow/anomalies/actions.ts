"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { getAnomalyReport, getProfile, type AnomalyQuery } from "@spencare/domain-application";
import { resolveProviderAdapter, NoProviderConfiguredError } from "@spencare/ai";
import type { AuthContext } from "@spencare/domain-application";
import type { AnomalyReport, AnomalyFinding } from "@spencare/domain-core";

export interface AnomalyReportActionResult {
  data: AnomalyReport | null;
  error: string | null;
}

export interface ExplainAnomalyActionResult {
  explanation: string | null;
  error: string | null;
}

/**
 * Fetches the anomaly report for the given query parameters.
 * Called on initial page load and when the user changes the period.
 */
export async function fetchAnomalyReport(
  query: AnomalyQuery,
): Promise<AnomalyReportActionResult> {
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
    const data = await getAnomalyReport(ctx, query);
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return { data: null, error: message };
  }
}

/**
 * Generates an AI explanation for a specific anomaly finding.
 *
 * Accepts the AnomalyQuery (not client-supplied findings) and re-runs
 * anomaly detection server-side so the AI prompt is always based on
 * authoritative server-computed data. The finding is located by its ID
 * in the freshly-computed report.
 *
 * Privacy mode is resolved server-side; the client never controls redaction.
 */
export async function explainAnomaly(
  query: AnomalyQuery,
  findingId: string,
): Promise<ExplainAnomalyActionResult> {
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

  // Re-run detection server-side — never trust client-supplied findings.
  let report: AnomalyReport;
  try {
    report = await getAnomalyReport(ctx, query);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not run anomaly detection.";
    return { explanation: null, error: message };
  }

  const finding = report.findings.find((f) => f.id === findingId);
  if (!finding) {
    return { explanation: null, error: "Finding not found in current report. Try refreshing." };
  }

  // Resolve privacy mode server-side.
  const profile = await getProfile(ctx);
  const privacyMode = profile?.privacy_mode_enabled ?? false;

  const context = buildAnomalyAiContext(finding, report, privacyMode);

  const systemPrompt = [
    "You are Spensa, a personal finance assistant for Spencare.",
    "You are helping the user understand a specific spending anomaly detected in their transactions.",
    "You will receive structured data about one anomaly finding. Your job is to explain what was observed clearly and honestly.",
    "",
    "Rules:",
    "- Use cautious language: this is an investigation lead, not proof of fraud or error.",
    "- Describe what the data shows; do not invent transactions, amounts, or causes.",
    "- Suggest concrete next steps the user can take to investigate.",
    "- If the data is partial or uncertain, acknowledge it.",
    "- Be concise: 3–5 sentences.",
    privacyMode ? "- Financial amounts are redacted for privacy. Do not speculate about amounts." : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const adapter = await resolveProviderAdapter(ctx);
    let text = "";
    for await (const event of adapter.chat([{ role: "user", content: context }], [], systemPrompt)) {
      if (event.type === "text_delta") text += event.text;
    }
    return { explanation: text.trim() || null, error: null };
  } catch (err) {
    if (err instanceof NoProviderConfiguredError) {
      return { explanation: buildDeterministicFindingExplanation(finding), error: null };
    }
    const message = err instanceof Error ? err.message : "AI explanation unavailable.";
    return { explanation: buildDeterministicFindingExplanation(finding), error: message };
  }
}

// ---------------------------------------------------------------------------
// AI context builder
// ---------------------------------------------------------------------------

function buildAnomalyAiContext(
  finding: AnomalyFinding,
  report: AnomalyReport,
  privacyMode: boolean,
): string {
  const fmt = (v: number) =>
    privacyMode ? "[redacted]" : `${Math.round(v / 100).toLocaleString()} ${report.currency}`;

  const baseline =
    finding.baselineValueMinor !== null
      ? `Baseline reference: ${fmt(finding.baselineValueMinor)}`
      : "No baseline (duplicate detection)";

  const steps = finding.investigationSteps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const limitations = finding.limitations.length > 0
    ? `\nLimitations:\n${finding.limitations.map((l) => `  - ${l}`).join("\n")}`
    : "";

  return [
    `Anomaly Finding: ${finding.title}`,
    `Type: ${finding.type}`,
    `Severity: ${finding.severity}`,
    `Description: ${finding.description}`,
    `Observed value: ${fmt(finding.observedValueMinor)}`,
    baseline,
    `Evidence transaction IDs: ${finding.evidenceTransactionIds.join(", ")}`,
    `Current period: ${report.currentPeriod.start} to ${report.currentPeriod.end}`,
    `Baseline period: ${report.baselinePeriod.start} to ${report.baselinePeriod.end}`,
    `\nSuggested investigation steps:\n${steps}`,
    limitations,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

function buildDeterministicFindingExplanation(finding: AnomalyFinding): string {
  const typeLabels: Record<string, string> = {
    large_transaction: "an unusually large transaction",
    category_spike: "a spending spike in a category",
    merchant_spike: "a spending spike at a merchant",
    duplicate_candidate: "a possible duplicate transaction",
  };
  const typeLabel = typeLabels[finding.type] ?? "an anomaly";
  const stepsNote =
    finding.investigationSteps.length > 0
      ? ` Suggested next step: ${finding.investigationSteps[0]}`
      : "";
  return `${finding.title} was flagged as ${typeLabel}. ${finding.description}${stepsNote}`;
}
