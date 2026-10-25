/**
 * Account management screen — list, add, and archive financial accounts.
 * Supports bank, cash, credit card, and investment account types.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";
import { api, type AccountJSON } from "@/lib/api";

type AccountType = "bank" | "cash" | "credit_card" | "investment";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  cash: "Cash",
  credit_card: "Credit Card",
  investment: "Investment",
};

const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  bank: "🏦",
  cash: "💵",
  credit_card: "💳",
  investment: "📈",
};

function formatBalance(minor: number, currency: string): string {
  const major = minor / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(major);
}

function accountBalance(account: AccountJSON): number {
  if (account.type === "credit_card") return -(account.credit_used_minor ?? 0);
  if (account.type === "investment") return account.market_value_minor ?? 0;
  return account.balance_minor;
}

export default function AccountsScreen(): React.JSX.Element {
  const { session } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [accounts, setAccounts] = useState<AccountJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Add form state
  const [newType, setNewType] = useState<AccountType>("bank");
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("INR");
  const [newBalance, setNewBalance] = useState("");
  const [newCreditLimit, setNewCreditLimit] = useState("");
  const [newCreditUsed, setNewCreditUsed] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  const loadAccounts = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api.getAccounts(session.accessToken);
      setAccounts(data.accounts.filter((a) => !a.is_archived));
    } catch {
      // Keep previous state on error.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  function resetForm() {
    setNewName("");
    setNewBalance("");
    setNewCreditLimit("");
    setNewCreditUsed("");
    setNewCurrency("INR");
    setNewType("bank");
    setFormError(null);
  }

  async function handleAddAccount(): Promise<void> {
    if (!session) return;
    setFormError(null);

    if (!newName.trim()) { setFormError("Account name is required."); return; }
    if (newName.trim().length > 80) { setFormError("Name is too long."); return; }
    if (newCurrency.length !== 3 || !/^[A-Z]{3}$/.test(newCurrency)) {
      setFormError("Currency must be a 3-letter code (e.g. INR, USD).");
      return;
    }

    let body: Record<string, unknown>;

    if (newType === "bank" || newType === "cash") {
      const parsed = parseFloat(newBalance.replace(/,/g, ""));
      if (isNaN(parsed)) { setFormError("Enter a valid balance."); return; }
      if (newType === "cash" && parsed < 0) { setFormError("Cash balance cannot be negative."); return; }
      body = { type: newType, name: newName.trim(), currency: newCurrency, balanceMinor: Math.round(parsed * 100) };
    } else if (newType === "credit_card") {
      const limit = parseFloat(newCreditLimit.replace(/,/g, ""));
      const used = parseFloat(newCreditUsed.replace(/,/g, "") || "0");
      if (isNaN(limit) || limit <= 0) { setFormError("Enter a valid credit limit."); return; }
      if (isNaN(used) || used < 0) { setFormError("Credit used cannot be negative."); return; }
      if (used > limit) { setFormError("Credit used cannot exceed the limit."); return; }
      body = {
        type: "credit_card",
        name: newName.trim(),
        currency: newCurrency,
        creditLimitMinor: Math.round(limit * 100),
        creditUsedMinor: Math.round(used * 100),
      };
    } else {
      const parsed = parseFloat(newBalance.replace(/,/g, ""));
      if (isNaN(parsed) || parsed < 0) { setFormError("Enter a valid market value."); return; }
      body = { type: "investment", name: newName.trim(), currency: newCurrency, marketValueMinor: Math.round(parsed * 100) };
    }

    setSavingNew(true);
    try {
      const { account } = await api.createAccount(body, session.accessToken);
      setAccounts((prev) => [...prev, account as unknown as AccountJSON]);
      setShowAddForm(false);
      resetForm();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      setFormError(raw || "Couldn't create account. Try again.");
    } finally {
      setSavingNew(false);
    }
  }

  function confirmArchive(account: AccountJSON) {
    Alert.alert(
      "Archive account",
      `Archive "${account.name}"? It will be hidden from your dashboard but you can restore it from the web app.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            if (!session) return;
            try {
              await api.archiveAccount(account.id, session.accessToken);
              setAccounts((prev) => prev.filter((a) => a.id !== account.id));
            } catch (err: unknown) {
              const raw = err instanceof Error ? err.message : "";
              Alert.alert("Error", raw || "Couldn't archive account.");
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Accounts</Text>
        <TouchableOpacity
          onPress={() => { setShowAddForm((v) => !v); resetForm(); }}
          style={styles.addButton}
          accessibilityRole="button"
          accessibilityLabel={showAddForm ? "Cancel" : "Add account"}
        >
          <Text style={styles.addButtonText}>{showAddForm ? "Cancel" : "+ Add"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Add form */}
        {showAddForm && (
          <View style={styles.addForm}>
            <Text style={styles.sectionTitle}>New account</Text>

            {formError ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            ) : null}

            {/* Type selector */}
            <Text style={styles.label}>Type</Text>
            <View style={styles.chipRow}>
              {(["bank", "cash", "credit_card", "investment"] as AccountType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.chip, newType === type && styles.chipSelected]}
                  onPress={() => { setNewType(type); setFormError(null); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: newType === type }}
                  accessibilityLabel={ACCOUNT_TYPE_LABELS[type]}
                >
                  <Text style={[styles.chipText, newType === type && styles.chipTextSelected]}>
                    {ACCOUNT_TYPE_LABELS[type]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder={`e.g. ${newType === "bank" ? "HDFC Savings" : newType === "cash" ? "Wallet" : newType === "credit_card" ? "HDFC Regalia" : "Zerodha"}`}
              placeholderTextColor={t.foregroundSubtle}
              value={newName}
              onChangeText={(v) => { setNewName(v); setFormError(null); }}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <Text style={styles.label}>Currency</Text>
            <TextInput
              style={[styles.input, { textTransform: "uppercase" }]}
              placeholder="INR"
              placeholderTextColor={t.foregroundSubtle}
              value={newCurrency}
              onChangeText={(v) => setNewCurrency(v.toUpperCase().slice(0, 3))}
              autoCapitalize="characters"
              maxLength={3}
              returnKeyType="next"
            />

            {(newType === "bank" || newType === "investment") && (
              <>
                <Text style={styles.label}>
                  {newType === "investment" ? "Market value" : "Current balance"}
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={t.foregroundSubtle}
                  value={newBalance}
                  onChangeText={(v) => setNewBalance(v)}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </>
            )}

            {newType === "cash" && (
              <>
                <Text style={styles.label}>Cash on hand</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={t.foregroundSubtle}
                  value={newBalance}
                  onChangeText={(v) => setNewBalance(v)}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </>
            )}

            {newType === "credit_card" && (
              <>
                <Text style={styles.label}>Credit limit</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={t.foregroundSubtle}
                  value={newCreditLimit}
                  onChangeText={(v) => setNewCreditLimit(v)}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                />
                <Text style={styles.label}>Amount currently owed</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={t.foregroundSubtle}
                  value={newCreditUsed}
                  onChangeText={(v) => setNewCreditUsed(v)}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.primaryButton, savingNew && styles.buttonDisabled]}
              onPress={handleAddAccount}
              disabled={savingNew}
              accessibilityRole="button"
              accessibilityLabel="Save account"
              accessibilityState={{ disabled: savingNew, busy: savingNew }}
            >
              {savingNew ? (
                <ActivityIndicator color={t.primaryForeground} />
              ) : (
                <Text style={styles.primaryButtonText}>Save account</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Accounts list */}
        {accounts.length === 0 && !showAddForm ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No accounts yet</Text>
            <Text style={styles.emptySubtitle}>
              Add your bank accounts, cash, credit cards, and investments to track your finances.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setShowAddForm(true)}
              accessibilityRole="button"
              accessibilityLabel="Add your first account"
            >
              <Text style={styles.primaryButtonText}>Add your first account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.accountsList}>
            {accounts.map((account) => (
              <View key={account.id} style={styles.accountCard}>
                <View style={styles.accountCardLeft}>
                  <Text style={styles.accountIcon}>
                    {ACCOUNT_TYPE_ICONS[account.type as AccountType] ?? "🏦"}
                  </Text>
                  <View>
                    <Text style={styles.accountName}>{account.name}</Text>
                    <Text style={styles.accountType}>
                      {ACCOUNT_TYPE_LABELS[account.type as AccountType]}
                    </Text>
                  </View>
                </View>
                <View style={styles.accountCardRight}>
                  <Text
                    style={[
                      styles.accountBalance,
                      accountBalance(account) < 0 && styles.accountBalanceNegative,
                    ]}
                  >
                    {formatBalance(accountBalance(account), account.currency)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => confirmArchive(account)}
                    style={styles.archiveButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Archive ${account.name}`}
                  >
                    <Text style={styles.archiveButtonText}>Archive</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.backgroundSubtle },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      backgroundColor: t.background,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    backButton: { minWidth: 60 },
    backText: { fontSize: typography.size.base, color: t.primary, fontWeight: typography.weight.medium },
    title: {
      fontSize: typography.size.lg,
      fontWeight: typography.weight.bold,
      color: t.foreground,
    },
    addButton: { minWidth: 60, alignItems: "flex-end" },
    addButtonText: { fontSize: typography.size.base, color: t.primary, fontWeight: typography.weight.semibold },
    scrollContent: { padding: spacing.lg, gap: spacing.lg },
    sectionTitle: {
      fontSize: typography.size.lg,
      fontWeight: typography.weight.bold,
      color: t.foreground,
      marginBottom: spacing.sm,
    },
    addForm: {
      backgroundColor: t.background,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: t.border,
    },
    label: {
      fontSize: typography.size.sm,
      fontWeight: typography.weight.medium,
      color: t.foreground,
    },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: typography.size.base,
      backgroundColor: t.backgroundSubtle,
      color: t.foreground,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.backgroundSubtle,
    },
    chipSelected: { backgroundColor: t.primarySubtle, borderColor: t.primary },
    chipText: { fontSize: typography.size.sm, color: t.foregroundMuted, fontWeight: typography.weight.medium },
    chipTextSelected: { color: t.primary },
    errorBox: {
      backgroundColor: t.destructiveSubtle,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: t.destructiveBorder,
    },
    errorText: { color: t.destructive, fontSize: typography.size.sm },
    primaryButton: {
      height: 48,
      backgroundColor: t.primary,
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.xs,
    },
    buttonDisabled: { opacity: 0.6 },
    primaryButtonText: {
      color: t.primaryForeground,
      fontSize: typography.size.base,
      fontWeight: typography.weight.semibold,
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: spacing.xxl,
      gap: spacing.md,
    },
    emptyTitle: {
      fontSize: typography.size.xl,
      fontWeight: typography.weight.bold,
      color: t.foreground,
    },
    emptySubtitle: {
      fontSize: typography.size.base,
      color: t.foregroundMuted,
      textAlign: "center",
      lineHeight: 22,
    },
    accountsList: { gap: spacing.sm },
    accountCard: {
      backgroundColor: t.background,
      borderRadius: radius.lg,
      padding: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: t.border,
    },
    accountCardLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
    accountIcon: { fontSize: 24 },
    accountName: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: t.foreground },
    accountType: { fontSize: typography.size.sm, color: t.foregroundMuted, marginTop: 2 },
    accountCardRight: { alignItems: "flex-end", gap: 4 },
    accountBalance: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: t.foreground },
    accountBalanceNegative: { color: t.destructive },
    archiveButton: { paddingVertical: 4, paddingHorizontal: spacing.sm },
    archiveButtonText: { fontSize: typography.size.sm, color: t.foregroundMuted },
  });
}
