/**
 * Trust-boundary tests for explainInvestigation.
 *
 * The action signature changed from `explainInvestigation(result:
 * InvestigationResult)` to `explainInvestigation(query: InvestigationQuery)`.
 * These tests verify that:
 *   1. The server always re-runs the investigation via getDecisionInvestigation.
 *   2. The explanation is based on the server-computed result, so no client-
 *      supplied figures can influence the AI prompt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InvestigationResult } from "@spencare/domain-core";
import type { InvestigationQuery } from "@spencare/domain-application";

// ---------------------------------------------------------------------------
// vi.hoisted — spies that must be referenced inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockGetDecisionInvestigation, mockGetProfile, mockCreateServerSupabase, FakeNoProviderConfiguredError } = vi.hoisted(() => {
  class FakeNoProviderConfiguredError extends Error {}
  const baseServerResult: InvestigationResult = {
    investigatedMetric: "total_expenses",
    metric: {
      metricId: "total_expenses",
      label: "Total Expenses",
      currency: "INR",
      currentValue: 500000,
      comparisonValue: 400000,
      absoluteDiff: 100000,
      percentageDiff: 25,
      currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
      comparisonPeriod: { start: "2026-09-01", end: "2026-09-30" },
      isPartialPeriod: false,
      limitations: [],
      currentPeriodTransactionIds: ["t1"],
      comparisonPeriodTransactionIds: ["t2"],
    },
    categoryContributors: [],
    merchantContributors: [],
    currency: "INR",
    limitations: [],
    calculatedAt: "2026-10-01T00:00:00.000Z",
  };

  const mockUser = { id: "test-user-1", email: "test@example.com" };

  const mockGetDecisionInvestigation = vi.fn(async () => baseServerResult);
  const mockGetProfile = vi.fn(async () => null);
  const mockCreateServerSupabase = vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockUser } })),
    },
  }));

  return { mockGetDecisionInvestigation, mockGetProfile, mockCreateServerSupabase, FakeNoProviderConfiguredError };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mockCreateServerSupabase,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

vi.mock("@spencare/domain-application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spencare/domain-application")>();
  return {
    ...actual,
    getDecisionInvestigation: mockGetDecisionInvestigation,
    getProfile: mockGetProfile,
  };
});

// Use NoProviderConfiguredError so the deterministic fallback runs — keeps
// the test independent of any real AI provider configuration.
vi.mock("@spencare/ai", () => ({
  resolveProviderAdapter: vi.fn(async () => {
    throw new FakeNoProviderConfiguredError();
  }),
  NoProviderConfiguredError: FakeNoProviderConfiguredError,
}));

// ---------------------------------------------------------------------------
// Import after all mocks are registered
// ---------------------------------------------------------------------------

import { explainInvestigation } from "./actions";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const query: InvestigationQuery = {
  metric: "total_expenses",
  currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
  comparisonPeriod: { start: "2026-09-01", end: "2026-09-30" },
  currency: "INR",
};

beforeEach(() => {
  mockGetDecisionInvestigation.mockClear();
  mockGetProfile.mockClear();
  mockCreateServerSupabase.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("explainInvestigation — trust boundary", () => {
  it("re-runs the investigation server-side when generating an explanation", async () => {
    const result = await explainInvestigation(query);

    expect(result.error).toBeNull();
    expect(mockGetDecisionInvestigation).toHaveBeenCalledTimes(1);
    expect(mockGetDecisionInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "test-user-1" }),
      query,
    );
  });

  it("explanation reflects server-computed direction when spending increased", async () => {
    // serverResult has absoluteDiff = 100 000 > 0 → increased
    const result = await explainInvestigation(query);
    expect(result.explanation).toMatch(/increased/i);
    expect(result.explanation).not.toMatch(/decreased/i);
  });

  it("explanation reflects DECREASED when server returns a decrease, regardless of query direction", async () => {
    // Override the mock to return a result where spending decreased.
    mockGetDecisionInvestigation.mockResolvedValueOnce({
      investigatedMetric: "total_expenses" as const,
      metric: {
        metricId: "total_expenses",
        label: "Total Expenses",
        currency: "INR",
        currentValue: 300000,
        comparisonValue: 400000,
        absoluteDiff: -100000,
        percentageDiff: -25,
        currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
        comparisonPeriod: { start: "2026-09-01", end: "2026-09-30" },
        isPartialPeriod: false,
        limitations: [],
        currentPeriodTransactionIds: [],
        comparisonPeriodTransactionIds: ["t2"],
      },
      categoryContributors: [],
      merchantContributors: [],
      currency: "INR",
      limitations: [],
      calculatedAt: "2026-10-01T00:00:00.000Z",
    });

    const result = await explainInvestigation(query);
    expect(result.explanation).toMatch(/decreased/i);
    expect(result.explanation).not.toMatch(/increased/i);
  });

  it("returns an error when getDecisionInvestigation throws — no explanation is fabricated", async () => {
    mockGetDecisionInvestigation.mockRejectedValueOnce(new Error("DB unavailable"));
    const result = await explainInvestigation(query);
    expect(result.explanation).toBeNull();
    expect(result.error).toMatch(/DB unavailable/i);
  });

  it("returns not-authenticated when the user is not logged in", async () => {
    mockCreateServerSupabase.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    } as unknown as Awaited<ReturnType<typeof mockCreateServerSupabase>>);

    const result = await explainInvestigation(query);
    expect(result.explanation).toBeNull();
    expect(result.error).toMatch(/not authenticated/i);
    // investigation must NOT have been called for an unauthenticated request
    expect(mockGetDecisionInvestigation).not.toHaveBeenCalled();
  });
});
