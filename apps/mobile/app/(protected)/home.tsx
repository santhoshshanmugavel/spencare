import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { api, type BudgetWithUsageJSON, type DashboardResponse, type MoneyJSON } from "@/lib/api";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";

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

function SectionLabel({ label, t }: { label: string; t: Theme }): React.JSX.Element {
  const styles = useMemo(() => makeSectionLabelStyles(t), [t]);
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function makeSectionLabelStyles(t: Theme) {
  return StyleSheet.create({
    sectionLabel: {
      fontSize: typography.size.sm,
      fontWeight: typography.weight.semibold,
      color: t.foregroundMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
      marginTop: spacing.xs,
    },
  });
}

function Card({ children, t }: { children: React.ReactNode; t: Theme }): React.JSX.Element {
  const styles = useMemo(() => makeCardStyles(t), [t]);
  return <View style={styles.card}>{children}</View>;
}

function makeCardStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      marginBottom: spacing.lg,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 4,
      elevation: 2,
    },
  });
}

function SafeToSpendCard({
  data,
  privacyMode,
  t,
}: {
  data: DashboardResponse["safeToSpend"];
  privacyMode: boolean;
  t: Theme;
}): React.JSX.Element {
  const styles = useMemo(() => makeSafeToSpendStyles(t), [t]);
  const isNegative = parseInt(data.amount.amountMinorUnits, 10) < 0;
  return (
    <View style={styles.heroCard}>
      <Text style={styles.heroLabel}>Safe to Spend</Text>
      <Text style={[styles.heroAmount, isNegative && styles.heroAmountNegative]}>
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

function makeSafeToSpendStyles(t: Theme) {
  return StyleSheet.create({
    heroCard: {
      backgroundColor: t.primary,
      borderRadius: radius.lg,
      padding: spacing.xl,
      marginBottom: 20,
    },
    heroLabel: {
      fontSize: typography.size.sm,
      fontWeight: typography.weight.medium,
      color: "rgba(255,255,255,0.75)",
      marginBottom: spacing.sm - 2,
    },
    heroAmount: {
      fontSize: typography.size["5xl"],
      fontWeight: typography.weight.extrabold,
      color: "#FFFFFF",
      letterSpacing: -1,
    },
    heroAmountNegative: { color: "rgba(255,200,200,1)" },
    heroSub: { fontSize: typography.size.sm, color: "rgba(255,255,255,0.65)", marginTop: spacing.xs },
  });
}

function AccountsCard({
  accounts,
  privacyMode,
  t,
}: {
  accounts: DashboardResponse["accounts"];
  privacyMode: boolean;
  t: Theme;
}): React.JSX.Element {
  const styles = useMemo(() => makeRowStyles(t), [t]);
  const visible = accounts.filter((a) => !a.is_archived);
  if (visible.length === 0) {
    return (
      <Card t={t}>
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
    <Card t={t}>
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
  t,
}: {
  cashFlow: DashboardResponse["cashFlow"];
  currency: string;
  privacyMode: boolean;
  t: Theme;
}): React.JSX.Element {
  const styles = useMemo(() => makeCashFlowStyles(t), [t]);
  return (
    <Card t={t}>
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

function makeCashFlowStyles(t: Theme) {
  return StyleSheet.create({
    cashFlowRow: { flexDirection: "row", alignItems: "center" },
    cashFlowItem: { flex: 1, alignItems: "center" },
    cashFlowDivider: { width: 1, height: 36, backgroundColor: t.separator },
    cashFlowLabel: {
      fontSize: typography.size.xs,
      color: t.foregroundSubtle,
      marginBottom: spacing.xs,
      textTransform: "uppercase",
    },
    cashFlowAmount: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
    positive: { color: t.income },
    negative: { color: t.destructive },
  });
}

function GoalsCard({
  goals,
  privacyMode,
  t,
}: {
  goals: DashboardResponse["goals"];
  privacyMode: boolean;
  t: Theme;
}): React.JSX.Element {
  const styles = useMemo(() => makeGoalStyles(t), [t]);
  const active = goals.filter((g) => g.status === "active");
  if (active.length === 0) {
    return (
      <Card t={t}>
        <Text style={styles.emptyText}>No active goals</Text>
      </Card>
    );
  }
  return (
    <Card t={t}>
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

function makeGoalStyles(t: Theme) {
  return StyleSheet.create({
    goalItem: { paddingVertical: 10 },
    goalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.sm - 2,
    },
    progressBg: {
      height: 6,
      backgroundColor: t.separator,
      borderRadius: radius.pill,
      overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: t.primary, borderRadius: radius.pill },
    goalAmounts: { fontSize: typography.size.xs, color: t.foregroundSubtle, marginTop: spacing.xs },
    rowLabel: { fontSize: typography.size.md, fontWeight: typography.weight.medium, color: t.foreground },
    rowSub: { fontSize: typography.size.sm, color: t.foregroundSubtle, marginTop: 2 },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: t.separator },
    emptyText: { fontSize: typography.size.base, color: t.foregroundSubtle, textAlign: "center", paddingVertical: spacing.sm },
  });
}

function BudgetsCard({
  budgets,
  currency,
  privacyMode,
  t,
}: {
  budgets: BudgetWithUsageJSON[];
  currency: string;
  privacyMode: boolean;
  t: Theme;
}): React.JSX.Element {
  const styles = useMemo(() => makeBudgetStyles(t), [t]);
  const top = [...budgets]
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .slice(0, 3);
  if (top.length === 0) {
    return (
      <Card t={t}>
        <Text style={styles.emptyText}>No budgets set up</Text>
      </Card>
    );
  }
  return (
    <Card t={t}>
      {top.map((b, i) => {
        const pct = Math.min(b.percentUsed / 100, 1);
        const barColor = b.percentUsed >= 100 ? t.destructive : b.percentUsed >= 80 ? t.warning : t.income;
        return (
          <View key={b.id} style={[styles.budgetItem, i < top.length - 1 && styles.budgetBorder]}>
            <View style={styles.budgetHeader}>
              <Text style={styles.budgetName} numberOfLines={1}>
                {b.categoryName ?? b.categoryId}
              </Text>
              <Text style={[styles.budgetPct, { color: barColor }]}>
                {privacyMode ? "••%" : `${Math.round(b.percentUsed)}%`}
              </Text>
            </View>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${pct * 100}%` as `${number}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={styles.budgetAmounts}>
              {privacyMode
                ? "•••• / ••••"
                : `${formatMinor(b.spentMinor, currency, false)} / ${formatMinor(b.limitMinor, currency, false)}`}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

function makeBudgetStyles(t: Theme) {
  return StyleSheet.create({
    budgetItem: { paddingVertical: spacing.sm },
    budgetBorder: { borderBottomWidth: 1, borderBottomColor: t.separator },
    budgetHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.xs,
    },
    budgetName: {
      fontSize: typography.size.md,
      fontWeight: typography.weight.medium,
      color: t.foreground,
      flex: 1,
      marginRight: spacing.sm,
    },
    budgetPct: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
    progressBg: {
      height: 6,
      backgroundColor: t.separator,
      borderRadius: radius.pill,
      overflow: "hidden",
      marginBottom: spacing.xs,
    },
    progressFill: { height: "100%", borderRadius: radius.pill },
    budgetAmounts: { fontSize: typography.size.xs, color: t.foregroundSubtle },
    emptyText: {
      fontSize: typography.size.base,
      color: t.foregroundSubtle,
      textAlign: "center",
      paddingVertical: spacing.sm,
    },
  });
}

function BillsCard({
  bills,
  privacyMode,
  t,
}: {
  bills: DashboardResponse["upcomingBills"];
  privacyMode: boolean;
  t: Theme;
}): React.JSX.Element {
  const styles = useMemo(() => makeRowStyles(t), [t]);
  if (bills.length === 0) {
    return (
      <Card t={t}>
        <Text style={styles.emptyText}>No upcoming bills</Text>
      </Card>
    );
  }
  return (
    <Card t={t}>
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

function makeRowStyles(t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.sm,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: t.separator },
    rowLabel: { fontSize: typography.size.md, fontWeight: typography.weight.medium, color: t.foreground },
    rowSub: { fontSize: typography.size.sm, color: t.foregroundSubtle, marginTop: 2 },
    rowAmount: { fontSize: typography.size.md, fontWeight: typography.weight.semibold, color: t.foreground },
    emptyText: {
      fontSize: typography.size.base,
      color: t.foregroundSubtle,
      textAlign: "center",
      paddingVertical: spacing.sm,
    },
    warning: { color: t.warning },
  });
}

// ── Main screen ───────────────────────────────────────────────────────────────

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: DashboardResponse; budgets: BudgetWithUsageJSON[] };

export default function HomeScreen(): React.JSX.Element {
  const { session } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeHomeStyles(t), [t]);

  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  // Tracks whether the initial load has completed; used to gate silent focus refreshes.
  const hasLoadedRef = useRef(false);

  const load = useCallback(
    async (mode: "full" | "refresh" | "silent" = "full"): Promise<void> => {
      if (!session) return;
      if (mode === "full") setState({ status: "loading" });
      if (mode === "refresh") setRefreshing(true);
      try {
        const [data, budgetsRes] = await Promise.all([
          api.getDashboard(session.accessToken),
          api.getBudgets(session.accessToken).catch(() => ({ budgets: [] as BudgetWithUsageJSON[] })),
        ]);
        setState({ status: "success", data, budgets: budgetsRes.budgets });
        hasLoadedRef.current = true;
      } catch (e) {
        // Silent refreshes on focus never surface an error — stale data is
        // better than an error flash every time the user switches tabs.
        if (mode !== "silent") {
          setState({ status: "error", message: e instanceof Error ? e.message : "Failed to load" });
        }
      } finally {
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void load("full");
  }, [load]);

  // Silently refresh privacy mode (and all data) whenever the screen regains
  // focus — e.g. after the user toggles Privacy Mode on the Profile tab.
  // Skip the first focus event because useEffect already handles the initial load.
  useFocusEffect(
    useCallback(() => {
      if (hasLoadedRef.current) void load("silent");
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    void load("refresh");
  }, [load]);

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={t.primary} />
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{state.message}</Text>
        <Text style={styles.retryText} onPress={() => void load("full")}>
          Tap to retry
        </Text>
      </View>
    );
  }

  const { data, budgets } = state;
  const { privacyMode } = data;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting}</Text>
        {privacyMode && <Text style={styles.privacyBadge}>Privacy On</Text>}
      </View>

      {/* Safe-to-Spend */}
      <SafeToSpendCard data={data.safeToSpend} privacyMode={privacyMode} t={t} />

      {/* This month */}
      <SectionLabel label="This Month" t={t} />
      <CashFlowCard cashFlow={data.cashFlow} currency={data.preferredCurrency} privacyMode={privacyMode} t={t} />

      {/* Accounts */}
      <SectionLabel label="Accounts" t={t} />
      <AccountsCard accounts={data.accounts} privacyMode={privacyMode} t={t} />

      {/* Goals */}
      {data.goals.some((g) => g.status === "active") && (
        <>
          <SectionLabel label="Goals" t={t} />
          <GoalsCard goals={data.goals} privacyMode={privacyMode} t={t} />
        </>
      )}

      {/* Budgets */}
      {budgets.length > 0 && (
        <>
          <SectionLabel label="Budgets" t={t} />
          <BudgetsCard budgets={budgets} currency={data.preferredCurrency} privacyMode={privacyMode} t={t} />
        </>
      )}

      {/* Upcoming bills */}
      <SectionLabel label="Upcoming Bills" t={t} />
      <BillsCard bills={data.upcomingBills} privacyMode={privacyMode} t={t} />

      <View style={styles.bottomPad} />
    </ScrollView>
  );
}

function makeHomeStyles(t: Theme) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: t.backgroundSubtle },
    scrollContent: { paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.xl },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: t.backgroundSubtle,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.lg,
    },
    greeting: {
      fontSize: typography.size["2xl"],
      fontWeight: typography.weight.bold,
      color: t.foreground,
    },
    privacyBadge: {
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
      color: t.primary,
      backgroundColor: t.primarySubtle,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    errorText: {
      fontSize: typography.size.md,
      color: t.destructive,
      textAlign: "center",
      marginHorizontal: spacing.xl,
    },
    retryText: {
      fontSize: typography.size.base,
      color: t.primary,
      marginTop: spacing.md,
      fontWeight: typography.weight.semibold,
    },
    bottomPad: { height: spacing.lg },
  });
}
