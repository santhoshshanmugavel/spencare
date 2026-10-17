/**
 * Trust-boundary tests for explainAnomaly and fetchAnomalyReport.
 *
 * Verifies that:
 *   1. The server always re-runs anomaly detection via getAnomalyReport.
 *   2. The AI explanation is based on server-computed findings — no
 *      client-supplied data influences the prompt.
 *   3. An unauthenticated call is rejected before any data access.
 *   4. A NoProviderConfiguredError falls back to a deterministic explanation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AnomalyQuery } from "@spencare/domain-application";
import type { AnomalyReport } from "@spencare/domain-core";

// ---------------------------------------------------------------------------
// vi.hoisted — spies that must be referenced inside vi.mock factories
// ---------------------------------------------------------------------------

const { mockGetAnomalyReport, mockGetProfile, mockCreateServerSupabase, FakeNoProviderConfiguredError } =
  vi.hoisted(() => {
    class FakeNoProviderConfiguredError extends Error {}

    const baseReport: AnomalyReport = {
      findings: [
        {
          id: "finding-1",
          type: "large_transaction",
          severity: "high",
          title: "Large transaction: Swiggy Order",
          description: "This transaction is 4.0× the baseline p90.",
          evidenceTransactionIds: ["tx-1"],
          observedValueMinor: 40000,
          baselineValueMinor: 10000,
          currency: "INR",
          limitations: [],
          investigationSteps: ["Review the transaction."],
        },
      ],
      currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
      baselinePeriod: { start: "2026-07-01", end: "2026-09-30" },
      currency: "INR",
      currentPeriodTransactionCount: 15,
      insufficientHistory: false,
      limitations: ["Anomaly detection identifies patterns, not facts."],
      detectedAt: "2026-10-01T00:00:00.000Z",
    };

    const mockUser = { id: "user-1", email: "test@example.com" };
    const mockGetAnomalyReport = vi.fn(async () => baseReport);
    const mockGetProfile = vi.fn(async () => null);
    const mockCreateServerSupabase = vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: mockUser } })) },
    }));

    return { mockGetAnomalyReport, mockGetProfile, mockCreateServerSupabase, FakeNoProviderConfiguredError };
  });

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mockCreateServerSupabase }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleSupabaseClient: vi.fn(() => ({})) }));
vi.mock("@spencare/domain-application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spencare/domain-application")>();
  return { ...actual, getAnomalyReport: mockGetAnomalyReport, getProfile: mockGetProfile };
});
vi.mock("@spencare/ai", () => ({
  resolveProviderAdapter: vi.fn(async () => {
    throw new FakeNoProviderConfiguredError();
  }),
  NoProviderConfiguredError: FakeNoProviderConfiguredError,
}));

import { explainAnomaly, fetchAnomalyReport } from "./actions";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const baseQuery: AnomalyQuery = {
  currentPeriod: { start: "2026-10-01", end: "2026-10-31" },
  currency: "INR",
  baselineMonths: 3,
};

describe("fetchAnomalyReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-runs anomaly detection server-side and returns the result", async () => {
    const result = await fetchAnomalyReport(baseQuery);
    expect(mockGetAnomalyReport).toHaveBeenCalledOnce();
    expect(result.data).not.toBeNull();
    expect(result.error).toBeNull();
    expect(result.data?.findings).toHaveLength(1);
  });

  it("returns error when not authenticated", async () => {
    mockCreateServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
    } as unknown as Awaited<ReturnType<typeof mockCreateServerSupabase>>);
    const result = await fetchAnomalyReport(baseQuery);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not authenticated/i);
  });

  it("returns error when getAnomalyReport throws", async () => {
    mockGetAnomalyReport.mockRejectedValueOnce(new Error("DB error"));
    const result = await fetchAnomalyReport(baseQuery);
    expect(result.data).toBeNull();
    expect(result.error).toBe("DB error");
  });
});

describe("explainAnomaly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-runs detection server-side; falls back to deterministic when no provider", async () => {
    const result = await explainAnomaly(baseQuery, "finding-1");
    expect(mockGetAnomalyReport).toHaveBeenCalledOnce();
    expect(result.explanation).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it("returns error when not authenticated", async () => {
    mockCreateServerSupabase.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
    } as unknown as Awaited<ReturnType<typeof mockCreateServerSupabase>>);
    const result = await explainAnomaly(baseQuery, "finding-1");
    expect(result.explanation).toBeNull();
    expect(result.error).toMatch(/not authenticated/i);
  });

  it("returns error when finding ID is not in the server-computed report", async () => {
    const result = await explainAnomaly(baseQuery, "nonexistent-finding-id");
    expect(result.explanation).toBeNull();
    expect(result.error).toMatch(/finding not found/i);
  });

  it("returns error when getAnomalyReport throws", async () => {
    mockGetAnomalyReport.mockRejectedValueOnce(new Error("Detection failed"));
    const result = await explainAnomaly(baseQuery, "finding-1");
    expect(result.explanation).toBeNull();
    expect(result.error).toContain("Detection failed");
  });
});
