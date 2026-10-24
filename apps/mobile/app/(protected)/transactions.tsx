import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "../../lib/auth";
import {
  api,
  type AccountJSON,
  type CategoryJSON,
  type TransactionJSON,
} from "../../lib/api";

// ── Money helpers ─────────────────────────────────────────────────────────────

function minorToMajor(minor: number): number {
  return minor / 100;
}

function formatMoney(minor: number, currency = "INR"): string {
  const major = minorToMajor(Math.abs(minor));
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

function majorToMinor(major: string): number {
  const n = parseFloat(major.replace(/,/g, ""));
  if (isNaN(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function groupKey(iso: string): string {
  const d = new Date(iso);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

// ── Type helpers ──────────────────────────────────────────────────────────────

function typeLabel(t: TransactionJSON["type"]): string {
  switch (t) {
    case "income": return "Income";
    case "expense": return "Expense";
    case "transfer": return "Transfer";
    case "goal_contribution": return "Goal deposit";
    case "goal_withdrawal": return "Goal withdrawal";
  }
}

export function isCredit(t: TransactionJSON): boolean {
  return t.type === "income" || t.type === "goal_withdrawal";
}

// ── Grouping ──────────────────────────────────────────────────────────────────

interface GroupedSection {
  date: string;
  label: string;
  items: TransactionJSON[];
}

export function buildSections(transactions: TransactionJSON[]): GroupedSection[] {
  const map = new Map<string, TransactionJSON[]>();
  for (const t of transactions) {
    const key = groupKey(t.occurred_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries()).map(([date, items]) => ({
    date,
    label: toLocalDate(items[0].occurred_at),
    items,
  }));
}

type ListItem =
  | { type: "header"; label: string }
  | { type: "row"; transaction: TransactionJSON };

function flatten(sections: GroupedSection[]): ListItem[] {
  const result: ListItem[] = [];
  for (const s of sections) {
    result.push({ type: "header", label: s.label });
    for (const t of s.items) result.push({ type: "row", transaction: t });
  }
  return result;
}

// ── Filter types and helpers ──────────────────────────────────────────────────

/**
 * Validates a YYYY-MM-DD string is both well-formed and a real calendar date.
 * JavaScript's Date constructor silently rolls over impossible dates (e.g.
 * 2026-02-30 → Mar 2), so we verify the output date matches the input.
 */
export function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  return d.toISOString().startsWith(s);
}

export type DateFilterMode = "all" | "this_month" | "last_month" | "custom";

export interface ActiveFilters {
  accountId: string | null;
  dateMode: DateFilterMode;
  from: string;
  to: string;
}

export const DEFAULT_FILTERS: ActiveFilters = {
  accountId: null,
  dateMode: "all",
  from: "",
  to: "",
};

/** Returns the first day of the current local month as YYYY-MM-DD. */
function currentMonthStart(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    "01",
  ].join("-");
}

/** Returns the last day of the current local month as YYYY-MM-DD. */
function currentMonthEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [
    last.getFullYear(),
    String(last.getMonth() + 1).padStart(2, "0"),
    String(last.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Returns the first day of the previous local month as YYYY-MM-DD. */
function prevMonthStart(): string {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return [
    first.getFullYear(),
    String(first.getMonth() + 1).padStart(2, "0"),
    "01",
  ].join("-");
}

/** Returns the last day of the previous local month as YYYY-MM-DD. */
function prevMonthEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return [
    last.getFullYear(),
    String(last.getMonth() + 1).padStart(2, "0"),
    String(last.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Resolves a DateFilterMode to the `from`/`to` API params. */
export function getDateRange(
  mode: DateFilterMode,
  from: string,
  to: string,
): { from?: string; to?: string } {
  if (mode === "all") return {};
  if (mode === "this_month") return { from: currentMonthStart(), to: currentMonthEnd() };
  if (mode === "last_month") return { from: prevMonthStart(), to: prevMonthEnd() };
  // custom — only set bounds that are non-empty
  return { from: from || undefined, to: to || undefined };
}

/** Human-readable label for the active date filter chip. */
export function dateFilterLabel(mode: DateFilterMode, from: string, to: string): string {
  if (mode === "all") return "All dates";
  if (mode === "this_month") return "This month";
  if (mode === "last_month") return "Last month";
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `To ${to}`;
  return "Custom";
}

/** Number of non-default (active) filter dimensions. */
export function countActiveFilters(f: ActiveFilters): number {
  let n = 0;
  if (f.accountId !== null) n++;
  if (f.dateMode !== "all") n++;
  return n;
}

// ── TransactionRow ────────────────────────────────────────────────────────────

function TransactionRow({
  transaction,
  privacyMode,
  onEdit,
  onDelete,
}: {
  transaction: TransactionJSON;
  privacyMode: boolean;
  onEdit: (t: TransactionJSON) => void;
  onDelete: (t: TransactionJSON) => void;
}) {
  const credit = isCredit(transaction);
  const label = transaction.merchant ?? transaction.item_name ?? typeLabel(transaction.type);
  const sub = transaction.category_name ?? typeLabel(transaction.type);
  const amount = privacyMode
    ? "₹ ••••"
    : formatMoney(transaction.amount_minor, transaction.currency);
  const isEditable = transaction.type === "income" || transaction.type === "expense";

  function handleLongPress() {
    if (!isEditable) {
      Alert.alert("Not editable", "Transfers and goal transactions cannot be edited here.");
      return;
    }
    Alert.alert(
      label,
      "What would you like to do?",
      [
        { text: "Edit", onPress: () => onEdit(transaction) },
        { text: "Delete", style: "destructive", onPress: () => onDelete(transaction) },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  return (
    <TouchableOpacity
      style={styles.row}
      onLongPress={handleLongPress}
      delayLongPress={400}
      accessibilityLabel={`${label}, ${amount}. Long press to edit or delete.`}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Text style={[styles.rowAmount, credit ? styles.credit : styles.debit]}>
        {credit ? "+" : "−"}{amount}
      </Text>
    </TouchableOpacity>
  );
}

// ── AddTransactionModal ───────────────────────────────────────────────────────

interface AddTransactionModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: AccountJSON[];
  categories: CategoryJSON[];
  accessToken: string;
}

function AddTransactionModal({
  visible,
  onClose,
  onSaved,
  accounts,
  categories,
  accessToken,
}: AddTransactionModalProps) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amountText, setAmountText] = useState("");
  const [merchant, setMerchant] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayISO());
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    accounts.length > 0 ? accounts[0].id : null,
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    categories.length > 0 ? categories[0].id : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eligible accounts: bank/cash for expense, any non-credit for income
  const eligibleAccounts = accounts.filter((a) => !a.is_archived);

  async function handleSave() {
    setError(null);
    const amountMinor = majorToMinor(amountText);
    if (amountMinor <= 0) {
      setError("Enter a valid amount greater than zero.");
      return;
    }
    if (!selectedAccountId) {
      setError("Select an account.");
      return;
    }
    if (!selectedCategoryId) {
      setError("Select a category.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
      setError("Date must be YYYY-MM-DD.");
      return;
    }

    setSaving(true);
    try {
      await api.createTransaction(
        {
          kind,
          account_id: selectedAccountId,
          category_id: selectedCategoryId,
          amount_minor: amountMinor,
          merchant: merchant.trim() || undefined,
          occurred_at: occurredAt,
        },
        accessToken,
      );
      // Reset form
      setAmountText("");
      setMerchant("");
      setOccurredAt(todayISO());
      setKind("expense");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save transaction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalWrapper} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Add Transaction</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            <Text style={[styles.modalSaveText, saving && styles.dimmed]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          {/* Type tabs */}
          <View style={styles.typeTabs}>
            <TouchableOpacity
              style={[styles.typeTab, kind === "expense" && styles.typeTabActive]}
              onPress={() => setKind("expense")}
            >
              <Text style={[styles.typeTabText, kind === "expense" && styles.typeTabActiveText]}>
                Expense
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeTab, kind === "income" && styles.typeTabActive]}
              onPress={() => setKind("income")}
            >
              <Text style={[styles.typeTabText, kind === "income" && styles.typeTabActiveText]}>
                Income
              </Text>
            </TouchableOpacity>
          </View>

          {/* Amount */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Amount (₹)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={amountText}
              onChangeText={setAmountText}
            />
          </View>

          {/* Merchant */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Merchant / description (optional)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Swiggy"
              value={merchant}
              onChangeText={setMerchant}
              maxLength={120}
            />
          </View>

          {/* Date */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="2026-10-20"
              value={occurredAt}
              onChangeText={setOccurredAt}
              maxLength={10}
            />
          </View>

          {/* Account picker */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Account</Text>
            {eligibleAccounts.length === 0 ? (
              <Text style={styles.emptyPicker}>No accounts found. Add one in Settings.</Text>
            ) : (
              eligibleAccounts.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.pickerRow, selectedAccountId === a.id && styles.pickerRowSelected]}
                  onPress={() => setSelectedAccountId(a.id)}
                >
                  <Text style={[styles.pickerRowText, selectedAccountId === a.id && styles.pickerRowTextSelected]}>
                    {a.name}
                  </Text>
                  {selectedAccountId === a.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Category picker */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Category</Text>
            {categories.length === 0 ? (
              <Text style={styles.emptyPicker}>No categories found.</Text>
            ) : (
              categories.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pickerRow, selectedCategoryId === c.id && styles.pickerRowSelected]}
                  onPress={() => setSelectedCategoryId(c.id)}
                >
                  <Text style={[styles.pickerRowText, selectedCategoryId === c.id && styles.pickerRowTextSelected]}>
                    {c.name}
                  </Text>
                  {selectedCategoryId === c.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))
            )}
          </View>

          {error && <Text style={styles.formError}>{error}</Text>}

          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── EditTransactionModal ──────────────────────────────────────────────────────

interface EditTransactionModalProps {
  visible: boolean;
  transaction: TransactionJSON;
  onClose: () => void;
  onSaved: () => void;
  accounts: AccountJSON[];
  categories: CategoryJSON[];
  accessToken: string;
}

function EditTransactionModal({
  visible,
  transaction,
  onClose,
  onSaved,
  accounts,
  categories,
  accessToken,
}: EditTransactionModalProps) {
  const [amountText, setAmountText] = useState(
    minorToMajor(transaction.amount_minor).toFixed(2),
  );
  const [merchant, setMerchant] = useState(transaction.merchant ?? "");
  const [occurredAt, setOccurredAt] = useState(
    groupKey(transaction.occurred_at),
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(transaction.account_id);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(transaction.category_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = accounts.filter((a) => !a.is_archived);

  async function handleSave() {
    setError(null);
    const amountMinor = majorToMinor(amountText);
    if (amountMinor <= 0) {
      setError("Enter a valid amount greater than zero.");
      return;
    }
    if (!selectedAccountId) {
      setError("Select an account.");
      return;
    }
    if (!selectedCategoryId) {
      setError("Select a category.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
      setError("Date must be YYYY-MM-DD.");
      return;
    }

    setSaving(true);
    try {
      await api.updateTransaction(
        {
          transaction_id: transaction.id,
          account_id: selectedAccountId,
          category_id: selectedCategoryId,
          amount_minor: amountMinor,
          merchant: merchant.trim() || undefined,
          occurred_at: occurredAt,
        },
        accessToken,
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalWrapper} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Edit Transaction</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            <Text style={[styles.modalSaveText, saving && styles.dimmed]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          {/* Amount */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Amount (₹)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={amountText}
              onChangeText={setAmountText}
            />
          </View>

          {/* Merchant */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Merchant / description (optional)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Swiggy"
              value={merchant}
              onChangeText={setMerchant}
              maxLength={120}
            />
          </View>

          {/* Date */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="2026-10-20"
              value={occurredAt}
              onChangeText={setOccurredAt}
              maxLength={10}
            />
          </View>

          {/* Account picker */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Account</Text>
            {eligibleAccounts.length === 0 ? (
              <Text style={styles.emptyPicker}>No accounts found.</Text>
            ) : (
              eligibleAccounts.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.pickerRow, selectedAccountId === a.id && styles.pickerRowSelected]}
                  onPress={() => setSelectedAccountId(a.id)}
                >
                  <Text style={[styles.pickerRowText, selectedAccountId === a.id && styles.pickerRowTextSelected]}>
                    {a.name}
                  </Text>
                  {selectedAccountId === a.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* Category picker */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Category</Text>
            {categories.length === 0 ? (
              <Text style={styles.emptyPicker}>No categories found.</Text>
            ) : (
              categories.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pickerRow, selectedCategoryId === c.id && styles.pickerRowSelected]}
                  onPress={() => setSelectedCategoryId(c.id)}
                >
                  <Text style={[styles.pickerRowText, selectedCategoryId === c.id && styles.pickerRowTextSelected]}>
                    {c.name}
                  </Text>
                  {selectedCategoryId === c.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))
            )}
          </View>

          {error && <Text style={styles.formError}>{error}</Text>}

          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── FilterSheet ───────────────────────────────────────────────────────────────

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: ActiveFilters) => void;
  onClear: () => void;
  accounts: AccountJSON[];
  initialFilters: ActiveFilters;
}

const DATE_MODES: { value: DateFilterMode; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" },
];

function FilterSheet({ visible, onClose, onApply, onClear, accounts, initialFilters }: FilterSheetProps) {
  const [draftAccountId, setDraftAccountId] = useState<string | null>(initialFilters.accountId);
  const [draftDateMode, setDraftDateMode] = useState<DateFilterMode>(initialFilters.dateMode);
  const [draftFrom, setDraftFrom] = useState(initialFilters.from);
  const [draftTo, setDraftTo] = useState(initialFilters.to);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { accountId: initAccountId, dateMode: initDateMode, from: initFrom, to: initTo } = initialFilters;
  useEffect(() => {
    if (visible) {
      setDraftAccountId(initAccountId);
      setDraftDateMode(initDateMode);
      setDraftFrom(initFrom);
      setDraftTo(initTo);
      setValidationError(null);
    }
  }, [visible, initAccountId, initDateMode, initFrom, initTo]);

  function handleApply() {
    if (draftDateMode === "custom") {
      if (draftFrom && !isValidCalendarDate(draftFrom)) {
        setValidationError("Start date is not a valid calendar date (YYYY-MM-DD).");
        return;
      }
      if (draftTo && !isValidCalendarDate(draftTo)) {
        setValidationError("End date is not a valid calendar date (YYYY-MM-DD).");
        return;
      }
      if (draftFrom && draftTo && draftFrom > draftTo) {
        setValidationError("End date must be on or after the start date.");
        return;
      }
    }
    setValidationError(null);
    onApply({ accountId: draftAccountId, dateMode: draftDateMode, from: draftFrom, to: draftTo });
  }

  function handleClearAndClose() {
    onClear();
  }

  const eligibleAccounts = accounts.filter((a) => !a.is_archived);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalWrapper}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Filters</Text>
          <TouchableOpacity onPress={handleClearAndClose} style={styles.modalCancelBtn}>
            <Text style={[styles.modalCancelText, styles.filterClearAllText]}>Clear all</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          {/* Account filter */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Account</Text>
            <TouchableOpacity
              style={[styles.pickerRow, draftAccountId === null && styles.pickerRowSelected]}
              onPress={() => setDraftAccountId(null)}
              accessibilityLabel="All accounts"
            >
              <Text style={[styles.pickerRowText, draftAccountId === null && styles.pickerRowTextSelected]}>
                All accounts
              </Text>
              {draftAccountId === null && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
            {eligibleAccounts.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.pickerRow, draftAccountId === a.id && styles.pickerRowSelected]}
                onPress={() => setDraftAccountId(a.id)}
                accessibilityLabel={a.name}
              >
                <Text style={[styles.pickerRowText, draftAccountId === a.id && styles.pickerRowTextSelected]}>
                  {a.name}
                </Text>
                {draftAccountId === a.id && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          {/* Date filter */}
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Date range</Text>
            {DATE_MODES.map(({ value, label }) => (
              <TouchableOpacity
                key={value}
                style={[styles.pickerRow, draftDateMode === value && styles.pickerRowSelected]}
                onPress={() => { setDraftDateMode(value); setValidationError(null); }}
                accessibilityLabel={label}
              >
                <Text style={[styles.pickerRowText, draftDateMode === value && styles.pickerRowTextSelected]}>
                  {label}
                </Text>
                {draftDateMode === value && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          {draftDateMode === "custom" && (
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>From (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.formInput}
                placeholder="2026-01-01"
                value={draftFrom}
                onChangeText={(v) => { setDraftFrom(v); setValidationError(null); }}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                accessibilityLabel="From date"
              />
              <Text style={[styles.formLabel, { marginTop: 12 }]}>To (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.formInput}
                placeholder="2026-12-31"
                value={draftTo}
                onChangeText={(v) => { setDraftTo(v); setValidationError(null); }}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                accessibilityLabel="To date"
              />
              {validationError && <Text style={styles.formError}>{validationError}</Text>}
            </View>
          )}

          <View style={styles.bottomPad} />
        </ScrollView>

        <View style={styles.filterApplyRow}>
          <Pressable style={styles.filterApplyBtn} onPress={handleApply} accessibilityLabel="Apply filters">
            <Text style={styles.filterApplyBtnText}>Apply filters</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── TransactionsScreen ────────────────────────────────────────────────────────

export default function TransactionsScreen() {
  const { session } = useAuth();
  const [transactions, setTransactions] = useState<TransactionJSON[]>([]);
  const [accounts, setAccounts] = useState<AccountJSON[]>([]);
  const [categories, setCategories] = useState<CategoryJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<TransactionJSON | null>(null);
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const [filterDateMode, setFilterDateMode] = useState<DateFilterMode>("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  function clearFilters() {
    setFilterAccountId(null);
    setFilterDateMode("all");
    setFilterFrom("");
    setFilterTo("");
    load(true, DEFAULT_FILTERS);
  }

  function handleEditRequest(t: TransactionJSON) {
    setEditingTransaction(t);
  }

  function handleDeleteRequest(t: TransactionJSON) {
    Alert.alert(
      "Delete transaction?",
      `"${t.merchant ?? t.item_name ?? typeLabel(t.type)}" will be removed. This cannot be undone.`,
      [
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteTransaction(t.id, session!.accessToken);
              load(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to delete transaction.");
            }
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  const load = useCallback(
    async (silent = false, overrideFilters?: ActiveFilters) => {
      if (!session) return;
      if (!silent) setLoading(true);
      setError(null);
      const f = overrideFilters ?? {
        accountId: filterAccountId,
        dateMode: filterDateMode,
        from: filterFrom,
        to: filterTo,
      };
      const dateRange = getDateRange(f.dateMode, f.from, f.to);
      try {
        const [txRes, pmRes, accountsRes, categoriesRes] = await Promise.all([
          api.getTransactions(session.accessToken, {
            limit: 100,
            account_id: f.accountId ?? undefined,
            ...dateRange,
          }),
          api.getPrivacyMode(session.accessToken),
          api.getAccounts(session.accessToken),
          api.getCategories(session.accessToken),
        ]);
        setTransactions(txRes.transactions);
        setPrivacyMode(pmRes.enabled);
        setAccounts(accountsRes.accounts);
        setCategories(categoriesRes.categories);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load transactions.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, filterAccountId, filterDateMode, filterFrom, filterTo],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const filteredTransactions = searchQuery.trim()
    ? transactions.filter((tx) => {
        const q = searchQuery.toLowerCase();
        return (
          tx.merchant?.toLowerCase().includes(q) ||
          tx.item_name?.toLowerCase().includes(q) ||
          tx.description?.toLowerCase().includes(q) ||
          tx.category_name?.toLowerCase().includes(q)
        );
      })
    : transactions;
  const sections = buildSections(filteredTransactions);
  const items = flatten(sections);
  const currentFilters: ActiveFilters = {
    accountId: filterAccountId,
    dateMode: filterDateMode,
    from: filterFrom,
    to: filterTo,
  };
  const activeFilterCount = countActiveFilters(currentFilters);
  const activeAccountName = filterAccountId
    ? (accounts.find((a) => a.id === filterAccountId)?.name ?? "Account")
    : null;

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>Transactions</Text>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search merchant, category…"
          placeholderTextColor="#9CA3AF"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search transactions"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.searchClear} accessibilityLabel="Clear search">
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter bar */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterBarContent}
        >
          <TouchableOpacity
            style={[styles.filterChip, filterAccountId !== null && styles.filterChipActive]}
            onPress={() => setShowFilterSheet(true)}
            accessibilityLabel={`Account filter: ${activeAccountName ?? "All accounts"}`}
          >
            <Text style={[styles.filterChipText, filterAccountId !== null && styles.filterChipTextActive]}>
              {activeAccountName ?? "All accounts"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterChip, filterDateMode !== "all" && styles.filterChipActive]}
            onPress={() => setShowFilterSheet(true)}
            accessibilityLabel={`Date filter: ${dateFilterLabel(filterDateMode, filterFrom, filterTo)}`}
          >
            <Text style={[styles.filterChipText, filterDateMode !== "all" && styles.filterChipTextActive]}>
              {dateFilterLabel(filterDateMode, filterFrom, filterTo)}
            </Text>
          </TouchableOpacity>

          {activeFilterCount > 0 && (
            <TouchableOpacity
              style={styles.filterClearChip}
              onPress={clearFilters}
              accessibilityLabel="Clear all filters"
            >
              <Text style={styles.filterClearChipText}>✕ Clear</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      {items.length === 0 ? (
        <View style={styles.center}>
          {activeFilterCount > 0 ? (
            <>
              <Text style={styles.emptyText}>No transactions found.</Text>
              <Text style={styles.emptySub}>Try adjusting or clearing your filters.</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>No transactions yet.</Text>
              <Text style={styles.emptySub}>Add your first expense or income to get started.</Text>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, idx) =>
            item.type === "header"
              ? `header-${item.label}`
              : `row-${item.transaction.id}-${idx}`
          }
          renderItem={({ item }) => {
            if (item.type === "header") {
              return <Text style={styles.dateHeader}>{item.label}</Text>;
            }
            return (
              <TransactionRow
                transaction={item.transaction}
                privacyMode={privacyMode}
                onEdit={handleEditRequest}
                onDelete={handleDeleteRequest}
              />
            );
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7C3AED" />
          }
          contentContainerStyle={styles.list}
        />
      )}

      {/* FAB */}
      <Pressable
        style={styles.fab}
        onPress={() => setShowAdd(true)}
        accessibilityLabel="Add transaction"
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      {showAdd && (
        <AddTransactionModal
          visible={showAdd}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load(true);
          }}
          accounts={accounts}
          categories={categories}
          accessToken={session?.accessToken ?? ""}
        />
      )}

      {editingTransaction && (
        <EditTransactionModal
          visible={true}
          transaction={editingTransaction}
          onClose={() => setEditingTransaction(null)}
          onSaved={() => {
            setEditingTransaction(null);
            load(true);
          }}
          accounts={accounts}
          categories={categories}
          accessToken={session?.accessToken ?? ""}
        />
      )}

      <FilterSheet
        visible={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        onApply={(newFilters) => {
          setFilterAccountId(newFilters.accountId);
          setFilterDateMode(newFilters.dateMode);
          setFilterFrom(newFilters.from);
          setFilterTo(newFilters.to);
          setShowFilterSheet(false);
          load(true, newFilters);
        }}
        onClear={() => {
          setShowFilterSheet(false);
          clearFilters();
        }}
        accounts={accounts}
        initialFilters={currentFilters}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  screenTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    backgroundColor: "#F5F5F5",
  },
  // Search bar
  searchBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#737373",
    height: 40,
  },
  searchClear: { padding: 4 },
  searchClearText: { fontSize: 12, color: "#999" },
  // Filter bar
  filterBar: { backgroundColor: "#F5F5F5", paddingVertical: 6, paddingBottom: 8 },
  filterBarContent: { paddingHorizontal: 16, gap: 8, flexDirection: "row", alignItems: "center" },
  filterChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#D0D0D0",
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "#fff",
  },
  filterChipActive: { borderColor: "#7C3AED", backgroundColor: "#FAF5FF" },
  filterChipText: { fontSize: 13, color: "#555" },
  filterChipTextActive: { color: "#7C3AED", fontWeight: "600" as const },
  filterClearChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "#EDE9FE",
  },
  filterClearChipText: { fontSize: 13, color: "#7C3AED", fontWeight: "600" as const },
  // Filter sheet
  filterApplyRow: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
  },
  filterApplyBtn: {
    backgroundColor: "#7C3AED",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center" as const,
  },
  filterApplyBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" as const },
  filterClearAllText: { color: "#DC2626", fontWeight: "600" as const },
  list: { paddingHorizontal: 16, paddingBottom: 96 },
  dateHeader: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
    letterSpacing: 0.4,
    paddingTop: 20,
    paddingBottom: 6,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  rowLeft: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: "600", color: "#111" },
  rowSub: { fontSize: 12, color: "#888", marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: "700" },
  credit: { color: "#16A34A" },
  debit: { color: "#DC2626" },
  errorText: { fontSize: 15, color: "#DC2626", textAlign: "center" },
  emptyText: { fontSize: 17, fontWeight: "600", color: "#333", textAlign: "center" },
  emptySub: { fontSize: 14, color: "#888", textAlign: "center", marginTop: 8 },
  // FAB
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#7C3AED",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fabIcon: { color: "#fff", fontSize: 28, fontWeight: "300", lineHeight: 32 },
  // Modal
  modalWrapper: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalTitle: { fontSize: 17, fontWeight: "600", color: "#111" },
  modalCancelBtn: { padding: 4 },
  modalCancelText: { fontSize: 16, color: "#888" },
  modalSaveBtn: { padding: 4 },
  modalSaveText: { fontSize: 16, color: "#7C3AED", fontWeight: "600" },
  dimmed: { opacity: 0.5 },
  modalBody: { flex: 1, paddingHorizontal: 16 },
  typeTabs: {
    flexDirection: "row",
    marginVertical: 16,
    borderRadius: 10,
    backgroundColor: "#F3F3F3",
    padding: 4,
  },
  typeTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  typeTabActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  typeTabText: { fontSize: 15, fontWeight: "500", color: "#888" },
  typeTabActiveText: { color: "#111", fontWeight: "600" },
  formGroup: { marginBottom: 20 },
  formLabel: { fontSize: 13, fontWeight: "600", color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  formInput: {
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111",
    backgroundColor: "#FAFAFA",
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 6,
    backgroundColor: "#FAFAFA",
  },
  pickerRowSelected: { borderColor: "#7C3AED", backgroundColor: "#FAF5FF" },
  pickerRowText: { fontSize: 15, color: "#555" },
  pickerRowTextSelected: { color: "#7C3AED", fontWeight: "600" },
  checkmark: { color: "#7C3AED", fontWeight: "700", fontSize: 16 },
  emptyPicker: { fontSize: 14, color: "#888", fontStyle: "italic" },
  formError: { fontSize: 14, color: "#DC2626", marginBottom: 12, textAlign: "center" },
  bottomPad: { height: 48 },
});
