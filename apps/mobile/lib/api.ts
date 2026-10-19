// Typed fetch wrapper for /api/mobile/* endpoints.
// All auth state (access token) is supplied by the caller via the options arg;
// this module has no global mutable state.

const API_BASE = process.env.EXPO_PUBLIC_API_URL;

if (!API_BASE) {
  // Fail loudly at module load so the developer sees this immediately.
  // In production, Metro will tree-shake the dead branch and this never fires
  // because EXPO_PUBLIC_API_URL is always set in the production build.
  throw new Error(
    "[Spencare] EXPO_PUBLIC_API_URL is not set.\n" +
      "Create apps/mobile/.env.local and add:\n" +
      "  EXPO_PUBLIC_API_URL=http://localhost:3000   (iOS Simulator)\n" +
      "  EXPO_PUBLIC_API_URL=http://10.0.2.2:3000   (Android Emulator)",
  );
}

export type ApiError = { error: string | Record<string, unknown> };

// ── Dashboard types ──────────────────────────────────────────────────────────

export interface MoneyJSON {
  amountMinorUnits: string;
  currency: string;
}

export interface SafeToSpendJSON {
  state: "no_accounts" | "balance_only" | "budget_only" | "goals_only" | "budget_and_goals";
  amount: MoneyJSON;
  availableBalance: MoneyJSON;
  budgetRemaining?: MoneyJSON;
  goalReservedTotal: MoneyJSON;
  cardPaymentReservedTotal: MoneyJSON;
  upcomingBillsTotal: MoneyJSON;
  commitmentReservedTotal: MoneyJSON;
  loanReservedTotal: MoneyJSON;
  ownedSpendableTotal: MoneyJSON;
  creditAvailableTotal: MoneyJSON;
}

export interface AccountJSON {
  id: string;
  name: string;
  type: "bank" | "cash" | "credit_card" | "investment" | "epfo";
  currency: string;
  balance_minor: number;
  credit_limit_minor: number | null;
  credit_used_minor: number | null;
  is_archived: boolean;
}

export interface GoalJSON {
  id: string;
  name: string;
  target_amount_minor: number;
  saved_amount_minor: number;
  target_date: string | null;
  status: "active" | "completed" | "archived";
}

export interface BillJSON {
  id: string;
  expected_amount_minor: number | null;
  expected_date: string;
  status: string;
  definition?: { name: string; currency: string };
}

export interface CashFlowJSON {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

export interface NetWorthJSON {
  netWorth: MoneyJSON;
  totalAssets: MoneyJSON;
  totalLiabilities: MoneyJSON;
}

export interface DashboardResponse {
  safeToSpend: SafeToSpendJSON;
  accounts: AccountJSON[];
  goals: GoalJSON[];
  upcomingBills: BillJSON[];
  cashFlow: CashFlowJSON;
  netWorth: NetWorthJSON;
  privacyMode: boolean;
}

export interface SignInNoMfaResponse {
  requires_2fa: false;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
}

export interface SignInMfaResponse {
  requires_2fa: true;
  challenge_token: string;
  expires_at: string;
}

export type SignInResponse = SignInNoMfaResponse | SignInMfaResponse;

export interface VerifyMfaResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
  mfa_method: "totp" | "backup_code";
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function get<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE as string}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as ApiError).error?.toString() ?? "Unknown error");
  return data as T;
}

async function post<T>(
  path: string,
  body: unknown,
  accessToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE as string}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error((data as ApiError).error?.toString() ?? "Unknown error");
  return data as T;
}

export const api = {
  getDashboard: (accessToken: string) =>
    get<DashboardResponse>("/api/mobile/dashboard", accessToken),

  signIn: (email: string, password: string) =>
    post<SignInResponse>("/api/mobile/auth/sign-in", { email, password }),

  verifyMfa: (challengeToken: string, code: string) =>
    post<VerifyMfaResponse>("/api/mobile/auth/verify-2fa", {
      challenge_token: challengeToken,
      code,
    }),

  refresh: (refreshToken: string) =>
    post<RefreshResponse>("/api/mobile/auth/refresh", { refresh_token: refreshToken }),

  signOut: (accessToken: string) =>
    post<{ success: boolean }>("/api/mobile/auth/sign-out", {}, accessToken),
};
