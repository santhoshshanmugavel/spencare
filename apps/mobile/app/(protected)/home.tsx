import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "@/lib/auth";
import { api, type DashboardResponse, type MoneyJSON } from "@/lib/api";

// ── Money formatting ─────────────────────────────────────────────────────────

const PRECISION: Record<string, number> = { INR: 100, USD: 100, EUR: 100, GBP: 100 };

function minorToMajor(m: MoneyJSON): number {
  return parseInt(m.amountMinorUnits, 10) / (PRECISION[m.currency] ?? 100);
}

function formatMoney(m: MoneyJSON, privacyMode: boolean): string {
  if (privacyMode) return "••••";
  const major = minorToMajor(m);
  const symbol = m.currency === "INR" ? "₹" : m.currency;
  return `${symbol}${Math.abs(major).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatMinor(minor: number, currency: string, privacyMode: boolean): string {
  if (privacyMode) return "••••";
  const major = minor / (PRECISION[currency] ?? 100);
  const symbol = currency === "INR" ? "₹" : currency;
  return `${symbol}${Math.abs(major).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }): React.JSX.Element {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function Card({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.card}>{children}</View>;
}

function SafeToSpendCard({
  data,
  privacyMode,
}: {
  data: DashboardResponse["safeToSpend"];
  privacyMode: boolean;
}): React.JSX.Element {
  const isNegative = parseInt(data.amount.amountMinorUnits, 10) < 0;
  return (
    <View style={styles.heroCard}>
      <Text style={styles.heroLabel}>Safe to Spend</Text>
      <Text style={[styles.heroAmount, isNegative && styles.negative]}>
        {formatMoney(data.amount, privacyMode)}
      </Text>
      <Text style={styles.heroSub}>
        Balance: {formatMoney(data.availableBalance, privacyMode)}
      </Text>
      {data.goalReservedTotal && parseInt(data.goalReservedTotal.amountMinorUnits, 10) > 0 && (
        <Text style={styles.heroSub}>
          Goals: −{formatMoney(data.goalReservedTotal, privacyMode)}
        </Text>
      )}
      {parseInt(data.upcomingBillsTotal.amountMinorUnits, 10) > 0 && (
        <Text style={styles.heroSub}>
          Bills: −{formatMoney(data.upcomingBillsTotal, privacyMode)}
        </Text>
      )}
    </View>
  );
}

function AccountsCard({
  accounts,
  privacyMode,
}: {
  accounts: DashboardResponse["accounts"];
  privacyMode: boolean;
}): React.JSX.Element {
  const visible = accounts.filter((a) => !a.is_archived);
  if (visible.length === 0) {
    return (
      <Card>
        <Text style={styles.emptyText}>No accounts yet</Text>
      </Card>
    );
  }
  const ACCOUNT_TYPE_LABELS: Record<string, string> = {
    bank: "Bank",
    cash: "Cash",
    credit_card: "Credit Card",
    investment: "Investment",
    epfo: "EPFO",
  };
  return (
    <Card>
      {visible.map((a, i) => (
        <View key={a.id} style={[styles.row, i < visible.length - 1 && styles.rowBorder]}>
          <View>
            <Text style={styles.rowLabel}>{a.name}</Text>
            <Text style={styles.rowSub}>{ACCOUNT_TYPE_LABELS[a.type] ?? a.type}</Text>
          </View>
          <Text style={styles.rowAmount}>
            {a.type === "investment"
              ? a.market_value_minor !== null
                ? formatMinor(a.market_value_minor, a.currency, privacyMode)
                : "—"
              : formatMinor(a.balance_minor, a.currency, privacyMode)}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function CashFlowCard({
  cashFlow,
  currency,
  privacyMode,
}: {
  cashFlow: DashboardResponse["cashFlow"];
  currency: string;
  privacyMode: boolean;
}): React.JSX.Element {
  return (
    <Card>
      <View style={styles.cashFlowRow}>
        <View style={styles.cashFlowItem}>
          <Text style={styles.cashFlowLabel}>Income</Text>
          <Text style={[styles.cashFlowAmount, styles.positive]}>
            {formatMinor(cashFlow.incomeMinor, currency, privacyMode)}
          </Text>
        </View>
        <View style={styles.cashFlowDivider} />
        <View style={styles.cashFlowItem}>
          <Text style={styles.cashFlowLabel}>Expenses</Text>
          <Text style={[styles.cashFlowAmount, styles.negative]}>
            {formatMinor(cashFlow.expenseMinor, currency, privacyMode)}
          </Text>
        </View>
        <View style={styles.cashFlowDivider} />
        <View style={styles.cashFlowItem}>
          <Text style={styles.cashFlowLabel}>Net</Text>
          <Text
            style={[
              styles.cashFlowAmount,
              cashFlow.netMinor >= 0 ? styles.positive : styles.negative,
            ]}
          >
            {formatMinor(Math.abs(cashFlow.netMinor), currency, privacyMode)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function GoalsCard({
  goals,
  privacyMode,
}: {
  goals: DashboardResponse["goals"];
  privacyMode: boolean;
}): React.JSX.Element {
  const active = goals.filter((g) => g.status === "active");
  if (active.length === 0) {
    return (
      <Card>
        <Text style={styles.emptyText}>No active goals</Text>
      </Card>
    );
  }
  return (
    <Card>
      {active.slice(0, 3).map((g, i) => {
        const pct =
          g.target_amount_minor > 0
            ? Math.min(100, Math.round((g.saved_amount_minor / g.target_amount_minor) * 100))
            : 0;
        return (
          <View key={g.id} style={[styles.goalItem, i < Math.min(active.length, 3) - 1 && styles.rowBorder]}>
            <View style={styles.goalHeader}>
              <Text style={styles.rowLabel}>{g.name}</Text>
              <Text style={styles.rowSub}>{pct}%</Text>
            </View>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            {!privacyMode && (
              <Text style={styles.goalAmounts}>
                ₹{(g.saved_amount_minor / 100).toLocaleString("en-IN")} /{" "}
                ₹{(g.target_amount_minor / 100).toLocaleString("en-IN")}
              </Text>
            )}
          </View>
        );
      })}
    </Card>
  );
}

function BillsCard({
  bills,
  privacyMode,
}: {
  bills: DashboardResponse["upcomingBills"];
  privacyMode: boolean;
}): React.JSX.Element {
  if (bills.length === 0) {
    return (
      <Card>
        <Text style={styles.emptyText}>No upcoming bills</Text>
      </Card>
    );
  }
  return (
    <Card>
      {bills.map((b, i) => {
        // Timezone-safe: normalise both sides to UTC midnight using local date
        // components so the day boundary matches what the user sees on their
        // clock regardless of UTC offset direction.
        const due = new Date(b.expected_date + "T00:00:00Z");
        const now = new Date();
        const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const daysUntil = Math.round((due.getTime() - todayUTC.getTime()) / 86400000);
        const dueSoon = daysUntil <= 3;
        return (
          <View key={b.id} style={[styles.row, i < bills.length - 1 && styles.rowBorder]}>
            <View>
              <Text style={styles.rowLabel}>{b.definition?.name || "Bill"}</Text>
              <Text style={[styles.rowSub, dueSoon && styles.warning]}>
                {daysUntil <= 0 ? "Due today" : daysUntil === 1 ? "Due tomorrow" : `Due in ${daysUntil} days`}
              </Text>
            </View>
            <Text style={[styles.rowAmount, dueSoon && styles.warning]}>
              {b.expected_amount_minor !== null
                ? formatMinor(b.expected_amount_minor, b.definition?.currency ?? "INR", privacyMode)
                : "—"}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: DashboardResponse };

export default function HomeScreen(): React.JSX.Element {
  const { session } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false): Promise<void> => {
      if (!session) return;
      if (!isRefresh) setState({ status: "loading" });
      try {
        const data = await api.getDashboard(session.accessToken);
        setState({ status: "success", data });
      } catch (e) {
        setState({ status: "error", message: e instanceof Error ? e.message : "Failed to load" });
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{state.message}</Text>
        <Text style={styles.retryText} onPress={() => void load()}>
          Tap to retry
        </Text>
      </View>
    );
  }

  const { data } = state;
  const { privacyMode } = data;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting}</Text>
        {privacyMode && <Text style={styles.privacyBadge}>Privacy On</Text>}
      </View>

      {/* Safe-to-Spend */}
      <SafeToSpendCard data={data.safeToSpend} privacyMode={privacyMode} />

      {/* This month */}
      <SectionLabel label="This Month" />
      <CashFlowCard cashFlow={data.cashFlow} currency={data.preferredCurrency} privacyMode={privacyMode} />

      {/* Accounts */}
      <SectionLabel label="Accounts" />
      <AccountsCard accounts={data.accounts} privacyMode={privacyMode} />

      {/* Goals */}
      {data.goals.some((g) => g.status === "active") && (
        <>
          <SectionLabel label="Goals" />
          <GoalsCard goals={data.goals} privacyMode={privacyMode} />
        </>
      )}

      {/* Upcoming bills */}
      <SectionLabel label="Upcoming Bills" />
      <BillsCard bills={data.upcomingBills} privacyMode={privacyMode} />

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f8fafc" },
  scrollContent: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 24 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8fafc" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  greeting: { fontSize: 22, fontWeight: "700", color: "#1e293b" },
  privacyBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: "#7c3aed",
    backgroundColor: "#ede9fe",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
  },
  heroCard: {
    backgroundColor: "#6366f1",
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
  },
  heroLabel: { fontSize: 13, fontWeight: "500", color: "#c7d2fe", marginBottom: 6 },
  heroAmount: { fontSize: 36, fontWeight: "800", color: "#ffffff", letterSpacing: -1 },
  heroSub: { fontSize: 12, color: "#a5b4fc", marginTop: 4 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  rowLabel: { fontSize: 15, fontWeight: "500", color: "#1e293b" },
  rowSub: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  cashFlowRow: { flexDirection: "row", alignItems: "center" },
  cashFlowItem: { flex: 1, alignItems: "center" },
  cashFlowDivider: { width: 1, height: 36, backgroundColor: "#f1f5f9" },
  cashFlowLabel: { fontSize: 11, color: "#94a3b8", marginBottom: 4, textTransform: "uppercase" },
  cashFlowAmount: { fontSize: 16, fontWeight: "700" },
  goalItem: { paddingVertical: 10 },
  goalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  progressBg: {
    height: 6,
    backgroundColor: "#f1f5f9",
    borderRadius: 99,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#6366f1", borderRadius: 99 },
  goalAmounts: { fontSize: 11, color: "#94a3b8", marginTop: 4 },
  emptyText: { fontSize: 14, color: "#94a3b8", textAlign: "center", paddingVertical: 8 },
  positive: { color: "#22c55e" },
  negative: { color: "#ef4444" },
  warning: { color: "#f59e0b" },
  errorText: { fontSize: 15, color: "#ef4444", textAlign: "center", marginHorizontal: 24 },
  retryText: { fontSize: 14, color: "#6366f1", marginTop: 12, fontWeight: "600" },
  bottomPad: { height: 16 },
});
