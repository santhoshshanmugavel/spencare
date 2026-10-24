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
  ownedSpendableTotal: MoneyJSON;
  creditAvailableTotal: MoneyJSON;
}

export interface AccountJSON {
  id: string;
  name: string;
  type: "bank" | "cash" | "credit_card" | "investment" | "epfo";
  currency: string;
  balance_minor: number;
  market_value_minor: number | null;
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

export interface CashFlowTrendPoint {
  periodStart: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

export interface CategorySpendSlice {
  categoryId: string | null;
  categoryName: string;
  amountMinor: number;
  percent: number;
}

export interface DashboardResponse {
  safeToSpend: SafeToSpendJSON;
  accounts: AccountJSON[];
  goals: GoalJSON[];
  upcomingBills: BillJSON[];
  cashFlow: CashFlowJSON;
  netWorth: NetWorthJSON;
  cashFlowTrend: CashFlowTrendPoint[];
  topCategories: CategorySpendSlice[];
  privacyMode: boolean;
  preferredCurrency: string;
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

export interface SignUpResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
}

export interface OnboardingStatusResponse {
  completed: boolean;
  displayName: string | null;
  preferredCurrency: string;
  timezone: string | null;
  interestedCategories: string[];
  interestedGoalTypes: string[];
  monthlyIncomeMinor: number | null;
  incomeFrequency: string | null;
}

export interface TransactionJSON {
  id: string;
  account_id: string;
  type: "income" | "expense" | "transfer" | "goal_contribution" | "goal_withdrawal";
  amount_minor: number;
  currency: string;
  category_id: string | null;
  category_name: string | null;
  item_name: string | null;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
  status: "posted" | "pending";
  transfer_pair_id: string | null;
  goal_id: string | null;
}

export interface TransactionsResponse {
  transactions: TransactionJSON[];
}

export interface TransactionParams {
  limit?: number;
  account_id?: string;
  category_id?: string;
  from?: string;
  to?: string;
}

export interface CategoryJSON {
  id: string;
  name: string;
  icon: string | null;
  is_system: boolean;
}

export interface CategoriesResponse {
  categories: CategoryJSON[];
}

export interface CreateTransactionBody {
  kind: "expense" | "income";
  account_id: string;
  category_id: string;
  amount_minor: number;
  merchant?: string;
  item_name?: string;
  description?: string;
  occurred_at: string;
}

export interface UpdateTransactionBody {
  transaction_id: string;
  account_id: string;
  category_id: string;
  amount_minor: number;
  merchant?: string;
  item_name?: string;
  description?: string;
  occurred_at: string;
}

export interface CreateTransactionResponse {
  transaction: TransactionJSON;
}

export interface UpdateTransactionResponse {
  transaction: TransactionJSON;
}

export interface PrivacyModeResponse {
  enabled: boolean;
}

// ── Goals types ───────────────────────────────────────────────────────────────

export interface GoalDetailJSON {
  id: string;
  name: string;
  target_amount_minor: number;
  saved_amount_minor: number;
  target_date: string | null;
  funding_account_id: string;
  status: "active" | "completed" | "archived";
  term: "short" | "long";
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
}

export interface GoalsResponse {
  goals: GoalDetailJSON[];
}

export interface GoalResponse {
  goal: GoalDetailJSON;
}

export interface CreateGoalBody {
  name: string;
  target_amount_minor: number;
  target_date?: string | null;
  funding_account_id: string;
  term?: "short" | "long";
  initial_saved_amount_minor?: number;
}

export interface UpdateGoalBody {
  goal_id: string;
  name?: string;
  target_amount_minor?: number;
  target_date?: string | null;
  funding_account_id?: string;
  term?: "short" | "long";
}

export interface AddContributionBody {
  goal_id: string;
  account_id: string;
  amount_minor: number;
}

// ── Budget types ──────────────────────────────────────────────────────────────

export type BudgetStatus = "under" | "near_limit" | "exceeded";

export interface BudgetWithUsageJSON {
  id: string;
  categoryId: string;
  categoryName?: string;
  periodStart: string;
  periodEnd: string;
  isRecurring: boolean;
  limitMinor: number;
  spentMinor: number;
  remainingMinor: number;
  percentUsed: number;
  status: BudgetStatus;
  actualSpendMinor?: number;
}

export interface BudgetsResponse {
  budgets: BudgetWithUsageJSON[];
}

export interface BudgetRowResponse {
  budget: {
    id: string;
    user_id: string;
    category_id: string;
    amount_minor: number;
    period_start: string;
    period_end: string;
    is_recurring: boolean;
    created_at: string;
    updated_at: string;
  };
}

export interface CreateBudgetBody {
  category_id: string;
  amount_minor: number;
  period_start: string;
  apply_to_upcoming?: boolean;
}

export interface UpdateBudgetBody {
  budget_id: string;
  amount_minor: number;
  apply_to_upcoming?: boolean;
}

export interface ContributionResponse {
  transaction: {
    id: string;
    account_id: string;
    type: string;
    amount_minor: number;
    currency: string;
    occurred_at: string;
    goal_id: string | null;
  };
  goal: GoalDetailJSON | null;
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

async function patch<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE as string}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as ApiError).error?.toString() ?? "Unknown error");
  return data as T;
}

async function put<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE as string}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as ApiError).error?.toString() ?? "Unknown error");
  return data as T;
}

async function del<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE as string}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error((data as ApiError).error?.toString() ?? "Unknown error");
  return data as T;
}

// ── Bills types ───────────────────────────────────────────────────────────────

export interface BillPredictionJSON {
  id: string;
  definition_id: string;
  expected_date: string;
  expected_amount_minor: number | null;
  status: "open" | "overdue" | "matched" | "skipped";
  paid_at: string | null;
  actual_amount_minor: number | null;
  name: string;
  recurrence_interval: string;
  currency: string;
  category_id: string | null;
}

export interface BillsResponse {
  bills: BillPredictionJSON[];
}

export interface MarkBillPaidBody {
  action: "mark_paid";
  prediction_id: string;
  account_id: string;
  category_id: string;
  amount_minor: number;
  occurred_at: string;
  merchant?: string;
  description?: string;
}

export interface CreateBillBody {
  merchant_pattern: string;
  recurrence_interval: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular";
  expected_amount_minor?: number | null;
  currency?: string;
  category_id?: string | null;
}

// ── Commitments & Loans types ─────────────────────────────────────────────────

export interface CommitmentJSON {
  id: string;
  name: string;
  amount_minor: number;
  currency: string;
  payment_frequency: string;
  next_payment_date: string | null;
  status: string;
  category_id: string | null;
  auto_pay_enabled: boolean;
}

export interface UpcomingDataResponse {
  commitments: CommitmentJSON[];
}

// ── Spensa AI types ───────────────────────────────────────────────────────────

export interface SpensaMessageBody {
  conversationId: string | null;
  content: string;
}

// ── Profile types ─────────────────────────────────────────────────────────────

export interface ProfileJSON {
  display_name: string | null;
  preferred_currency: string;
  timezone: string | null;
  privacy_mode_enabled: boolean;
  onboarding_completed: boolean;
}

export interface UpdateProfileBody {
  displayName?: string;
  preferredCurrency?: string;
  timezone?: string;
}

// ── Vehicles ──────────────────────────────────────────────────────────────────

export interface VehicleJSON {
  id: string;
  name: string;
  vehicle_type: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  manufacturing_year: number | null;
  registration_number: string | null;
  fuel_type: string;
  odometer_unit: string;
  fuel_unit: string;
  current_odometer: number; // tenths of odometer_unit (÷10 to get display value)
  status: "active" | "archived";
  notes: string | null;
  created_at: string;
}

export interface FuelEntryJSON {
  id: string;
  vehicle_id: string;
  occurred_at: string;
  odometer: number;          // tenths of unit
  fuel_quantity_ml: number;  // millilitres
  total_cost_minor: number | null;
  currency: string;
  fuel_type: string;
  is_full_tank: boolean;
  is_missed: boolean;
  station_name: string | null;
  notes: string | null;
}

export interface VehicleDashboardJSON {
  vehicle: VehicleJSON;
  efficiency: { type: string; intervalCount?: number; kmPerLitreCx100?: number };
  cost_per_km: { type: string; costPerKmCx100?: number; currency?: string };
  monthly_costs: Array<{ month: string; fuelCostMinor: number; otherCostMinor: number; totalCostMinor: number; currency: string; fuelLitresMl: number }>;
  total_fuel_cost_minor: number;
  total_other_cost_minor: number;
  total_cost_minor: number;
  currency: string;
}

export interface CreateVehicleBody {
  name: string;
  vehicle_type: string;
  fuel_type: string;
  odometer_unit?: string;
  fuel_unit?: string;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  manufacturing_year?: number | null;
  registration_number?: string | null;
  current_odometer?: number;
  notes?: string | null;
}

export interface UpdateVehicleBody {
  name?: string;
  make?: string | null;
  model?: string | null;
  registration_number?: string | null;
  current_odometer?: number;
  notes?: string | null;
  status?: "active" | "archived";
}

export interface CreateFuelEntryBody {
  occurred_at: string;
  odometer: number;         // tenths of unit
  fuel_quantity_ml: number; // millilitres
  total_cost_minor?: number | null;
  currency?: string;
  fuel_type?: string;
  is_full_tank?: boolean;
  is_missed?: boolean;
  station_name?: string | null;
  notes?: string | null;
}

export type VehicleExpenseCategory = "repair" | "accessories" | "tyres" | "cleaning" | "parking" | "toll" | "other";
export type MaintenanceCategory = "service" | "oil_change" | "tyre_rotation" | "tyre_replacement" | "brake_service" | "battery" | "chain" | "filter" | "other";
export type VehicleDocumentType = "insurance" | "puc" | "rc" | "road_tax" | "permit" | "warranty" | "other";

export interface VehicleExpenseJSON {
  id: string;
  vehicle_id: string;
  occurred_at: string;
  amount_minor: number;
  currency: string;
  expense_category: VehicleExpenseCategory;
  description: string | null;
  vendor: string | null;
  odometer: number | null;
  notes: string | null;
  created_at: string;
}

export interface MaintenanceRecordJSON {
  id: string;
  vehicle_id: string;
  title: string;
  maintenance_category: MaintenanceCategory;
  serviced_at: string | null;
  odometer: number | null;
  cost_minor: number | null;
  currency: string;
  vendor: string | null;
  notes: string | null;
  next_due_date: string | null;
  next_due_odometer: number | null;
  status: string;
  created_at: string;
}

export interface VehicleDocumentJSON {
  id: string;
  vehicle_id: string;
  document_type: VehicleDocumentType;
  title: string;
  issuer: string | null;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface VehicleReminderJSON {
  id: string;
  vehicle_id: string;
  reminder_type: string;
  title: string;
  due_date: string | null;
  due_odometer: number | null;
  is_dismissed: boolean;
  dismissed_at: string | null;
  created_at: string;
}

export interface CreateVehicleExpenseBody {
  occurred_at: string;
  amount_minor: number;
  currency?: string;
  expense_category?: VehicleExpenseCategory;
  description?: string | null;
  vendor?: string | null;
  odometer?: number | null;
  notes?: string | null;
}

export interface CreateMaintenanceBody {
  title: string;
  maintenance_category?: MaintenanceCategory;
  serviced_at?: string | null;
  odometer?: number | null;
  cost_minor?: number | null;
  currency?: string;
  vendor?: string | null;
  notes?: string | null;
  next_due_date?: string | null;
  next_due_odometer?: number | null;
  status?: "completed" | "upcoming" | "overdue";
}

export interface CreateVehicleDocumentBody {
  document_type: VehicleDocumentType;
  title: string;
  issuer?: string | null;
  reference_number?: string | null;
  issue_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
  reminder_days_before?: number[];
}

export const api = {
  getDashboard: (accessToken: string) =>
    get<DashboardResponse>("/api/mobile/dashboard", accessToken),

  signIn: (email: string, password: string) =>
    post<SignInResponse>("/api/mobile/auth/sign-in", { email, password }),

  signUp: (email: string, password: string) =>
    post<SignUpResponse>("/api/mobile/auth/sign-up", { email, password }),

  verifyMfa: (challengeToken: string, code: string) =>
    post<VerifyMfaResponse>("/api/mobile/auth/verify-2fa", {
      challenge_token: challengeToken,
      code,
    }),

  refresh: (refreshToken: string) =>
    post<RefreshResponse>("/api/mobile/auth/refresh", { refresh_token: refreshToken }),

  signOut: (accessToken: string) =>
    post<{ success: boolean }>("/api/mobile/auth/sign-out", {}, accessToken),

  forgotPassword: (email: string) =>
    post<{ ok: boolean }>("/api/mobile/auth/forgot-password", { email }),

  changePassword: (currentPassword: string, newPassword: string, accessToken: string) =>
    post<{ ok: boolean }>("/api/mobile/auth/change-password", { currentPassword, newPassword }, accessToken),

  // Onboarding
  getOnboardingStatus: (accessToken: string) =>
    get<OnboardingStatusResponse>("/api/mobile/onboarding", accessToken),

  saveOnboardingStep: (data: Record<string, unknown>, accessToken: string) =>
    post<{ success: boolean }>("/api/mobile/onboarding", data, accessToken),

  completeOnboarding: (data: Record<string, unknown>, accessToken: string) =>
    put<{ success: boolean }>("/api/mobile/onboarding", data, accessToken),

  // Accounts
  getAccounts: (accessToken: string) =>
    get<{ accounts: AccountJSON[] }>("/api/mobile/accounts", accessToken),

  createAccount: (data: Record<string, unknown>, accessToken: string) =>
    post<{ account: AccountJSON }>("/api/mobile/accounts", data, accessToken),

  updateAccount: (accountId: string, data: Record<string, unknown>, accessToken: string) =>
    patch<{ account: AccountJSON }>("/api/mobile/accounts", { accountId, ...data }, accessToken),

  archiveAccount: (accountId: string, accessToken: string) =>
    del<{ account: AccountJSON }>("/api/mobile/accounts", { accountId }, accessToken),

  // Privacy mode
  updatePrivacyMode: (enabled: boolean, accessToken: string) =>
    patch<{ enabled: boolean }>("/api/mobile/profile/privacy-mode", { enabled }, accessToken),

  // Google OAuth — PKCE code exchange (server-side MFA check).
  // Response shape mirrors SignInResponse; reuse existing types.
  googleAuth: (params: { code: string; code_verifier: string; redirect_uri: string }) =>
    post<SignInResponse>("/api/mobile/auth/google", params),

  // Transactions
  getTransactions: (accessToken: string, params?: TransactionParams) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.account_id) qs.set("account_id", params.account_id);
    if (params?.category_id) qs.set("category_id", params.category_id);
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return get<TransactionsResponse>(`/api/mobile/transactions${query}`, accessToken);
  },

  createTransaction: (body: CreateTransactionBody, accessToken: string) =>
    post<CreateTransactionResponse>("/api/mobile/transactions", body, accessToken),

  updateTransaction: (body: UpdateTransactionBody, accessToken: string) =>
    patch<UpdateTransactionResponse>("/api/mobile/transactions", body, accessToken),

  deleteTransaction: (transactionId: string, accessToken: string) =>
    del<void>("/api/mobile/transactions", { transaction_id: transactionId }, accessToken),

  // Categories
  getCategories: (accessToken: string) =>
    get<CategoriesResponse>("/api/mobile/categories", accessToken),

  createCategory: (body: { name: string; icon?: string }, accessToken: string) =>
    post<{ category: CategoryJSON }>("/api/mobile/categories", body, accessToken),

  updateCategory: (body: { categoryId: string; name?: string; icon?: string | null }, accessToken: string) =>
    patch<{ category: CategoryJSON }>("/api/mobile/categories", body, accessToken),

  deleteCategory: (categoryId: string, reassignToCategoryId: string, accessToken: string) =>
    del<void>("/api/mobile/categories", { categoryId, reassignToCategoryId }, accessToken),

  updateBill: (
    body: {
      bill_id: string;
      merchant_pattern?: string;
      expected_amount_minor?: number | null;
      recurrence_interval?: string;
      category_id?: string | null;
    },
    accessToken: string,
  ) =>
    patch<{ bill: unknown }>("/api/mobile/bills", { action: "update", ...body }, accessToken),

  // Privacy mode
  getPrivacyMode: (accessToken: string) =>
    get<PrivacyModeResponse>("/api/mobile/profile/privacy-mode", accessToken),

  // Goals
  getGoals: (accessToken: string, status?: "active" | "completed" | "archived" | "all") => {
    const qs = status ? `?status=${status}` : "";
    return get<GoalsResponse>(`/api/mobile/goals${qs}`, accessToken);
  },

  createGoal: (body: CreateGoalBody, accessToken: string) =>
    post<GoalResponse>("/api/mobile/goals", body, accessToken),

  updateGoal: (body: UpdateGoalBody, accessToken: string) =>
    patch<GoalResponse>("/api/mobile/goals", body, accessToken),

  archiveGoal: (goalId: string, accessToken: string) =>
    del<void>("/api/mobile/goals", { goal_id: goalId }, accessToken),

  addContribution: (body: AddContributionBody, accessToken: string) =>
    post<ContributionResponse>("/api/mobile/goals/contributions", body, accessToken),

  withdrawGoal: (body: AddContributionBody, accessToken: string) =>
    post<ContributionResponse>("/api/mobile/goals/withdrawals", body, accessToken),

  // Budgets
  getBudgets: (accessToken: string, periodStart?: string) => {
    const qs = periodStart ? `?period_start=${periodStart}` : "";
    return get<BudgetsResponse>(`/api/mobile/budgets${qs}`, accessToken);
  },

  createBudget: (body: CreateBudgetBody, accessToken: string) =>
    post<BudgetRowResponse>("/api/mobile/budgets", body, accessToken),

  updateBudget: (body: UpdateBudgetBody, accessToken: string) =>
    patch<BudgetRowResponse>("/api/mobile/budgets", body, accessToken),

  deleteBudget: (budgetId: string, accessToken: string) =>
    del<void>("/api/mobile/budgets", { budget_id: budgetId }, accessToken),

  // Bills
  getBills: (accessToken: string, status?: "upcoming" | "paid" | "all") => {
    const qs = status ? `?status=${status}` : "";
    return get<BillsResponse>(`/api/mobile/bills${qs}`, accessToken);
  },

  createBill: (body: CreateBillBody, accessToken: string) =>
    post<{ bill: unknown }>("/api/mobile/bills", body, accessToken),

  markBillPaid: (body: MarkBillPaidBody, accessToken: string) =>
    patch<{ success: boolean; transaction?: unknown }>("/api/mobile/bills", body, accessToken),

  deleteBill: (billId: string, accessToken: string) =>
    del<void>("/api/mobile/bills", { bill_id: billId }, accessToken),

  // Spensa AI — returns a fetch Response with SSE stream
  spensaChat: (body: SpensaMessageBody, accessToken: string): Promise<Response> => {
    return fetch(`${API_BASE as string}/api/mobile/spensa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  },

  // Vehicles
  listVehicles: (accessToken: string) =>
    get<{ vehicles: VehicleJSON[] }>("/api/mobile/vehicles", accessToken),

  createVehicle: (body: CreateVehicleBody, accessToken: string) =>
    post<{ vehicle: VehicleJSON }>("/api/mobile/vehicles", body, accessToken),

  getVehicle: (vehicleId: string, accessToken: string) =>
    get<VehicleDashboardJSON>(`/api/mobile/vehicles/${vehicleId}`, accessToken),

  updateVehicle: (vehicleId: string, body: UpdateVehicleBody, accessToken: string) =>
    patch<{ vehicle: VehicleJSON }>(`/api/mobile/vehicles/${vehicleId}`, body, accessToken),

  listFuelEntries: (vehicleId: string, accessToken: string, limit?: number) =>
    get<{ fuel_entries: FuelEntryJSON[] }>(
      `/api/mobile/vehicles/${vehicleId}/fuel-entries${limit ? `?limit=${limit}` : ""}`,
      accessToken,
    ),

  addFuelEntry: (vehicleId: string, body: CreateFuelEntryBody, accessToken: string) =>
    post<{ fuel_entry: FuelEntryJSON }>(
      `/api/mobile/vehicles/${vehicleId}/fuel-entries`,
      body,
      accessToken,
    ),

  deleteFuelEntry: (vehicleId: string, entryId: string, accessToken: string) =>
    del<void>(`/api/mobile/vehicles/${vehicleId}/fuel-entries/${entryId}`, undefined, accessToken),

  // Vehicle expenses
  listExpenses: (vehicleId: string, accessToken: string) =>
    get<{ expenses: VehicleExpenseJSON[] }>(`/api/mobile/vehicles/${vehicleId}/expenses`, accessToken),

  addExpense: (vehicleId: string, body: CreateVehicleExpenseBody, accessToken: string) =>
    post<{ expense: VehicleExpenseJSON }>(`/api/mobile/vehicles/${vehicleId}/expenses`, body, accessToken),

  deleteExpense: (vehicleId: string, expenseId: string, accessToken: string) =>
    del<void>(`/api/mobile/vehicles/${vehicleId}/expenses/${expenseId}`, undefined, accessToken),

  // Maintenance records
  listMaintenance: (vehicleId: string, accessToken: string) =>
    get<{ maintenance_records: MaintenanceRecordJSON[] }>(`/api/mobile/vehicles/${vehicleId}/maintenance`, accessToken),

  addMaintenance: (vehicleId: string, body: CreateMaintenanceBody, accessToken: string) =>
    post<{ maintenance_record: MaintenanceRecordJSON }>(`/api/mobile/vehicles/${vehicleId}/maintenance`, body, accessToken),

  deleteMaintenance: (vehicleId: string, recordId: string, accessToken: string) =>
    del<void>(`/api/mobile/vehicles/${vehicleId}/maintenance/${recordId}`, undefined, accessToken),

  // Vehicle documents
  listDocuments: (vehicleId: string, accessToken: string) =>
    get<{ documents: VehicleDocumentJSON[] }>(`/api/mobile/vehicles/${vehicleId}/documents`, accessToken),

  addDocument: (vehicleId: string, body: CreateVehicleDocumentBody, accessToken: string) =>
    post<{ document: VehicleDocumentJSON }>(`/api/mobile/vehicles/${vehicleId}/documents`, body, accessToken),

  deleteDocument: (vehicleId: string, documentId: string, accessToken: string) =>
    del<void>(`/api/mobile/vehicles/${vehicleId}/documents/${documentId}`, undefined, accessToken),

  // Vehicle reminders
  listReminders: (vehicleId: string, accessToken: string) =>
    get<{ reminders: VehicleReminderJSON[] }>(`/api/mobile/vehicles/${vehicleId}/reminders`, accessToken),

  dismissReminder: (vehicleId: string, reminderId: string, accessToken: string) =>
    patch<void>(`/api/mobile/vehicles/${vehicleId}/reminders/${reminderId}`, {}, accessToken),

  deleteVehicle: (vehicleId: string, accessToken: string) =>
    del<void>(`/api/mobile/vehicles/${vehicleId}`, undefined, accessToken),

  // Commitments & Loans
  getUpcoming: (accessToken: string) =>
    get<UpcomingDataResponse>("/api/mobile/upcoming", accessToken),

  pauseCommitment: (commitmentId: string, accessToken: string) =>
    patch<{ ok: boolean }>("/api/mobile/commitments", { action: "pause", commitment_id: commitmentId }, accessToken),

  resumeCommitment: (commitmentId: string, accessToken: string) =>
    patch<{ ok: boolean }>("/api/mobile/commitments", { action: "resume", commitment_id: commitmentId }, accessToken),

  deleteCommitment: (commitmentId: string, accessToken: string) =>
    patch<{ ok: boolean }>("/api/mobile/commitments", { action: "delete", commitment_id: commitmentId }, accessToken),

  markCommitmentPaid: (
    body: { commitment_id: string; account_id: string; category_id: string; amount_minor: number; occurred_at: string },
    accessToken: string,
  ) =>
    patch<{ ok: boolean; transactionId: string; nextOccurrenceDate: string | null }>(
      "/api/mobile/commitments",
      { action: "mark_paid", ...body },
      accessToken,
    ),

  // Profile
  getProfile: (accessToken: string) =>
    get<{ profile: ProfileJSON }>("/api/mobile/profile/me", accessToken),

  updateProfile: (body: UpdateProfileBody, accessToken: string) =>
    patch<{ profile: ProfileJSON }>("/api/mobile/profile/me", body, accessToken),
};
