import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
import { api, type BillPredictionJSON, type AccountJSON, type CategoryJSON } from "../../lib/api";
import { useTheme, typography } from "../../lib/theme";

// ── Money helpers ─────────────────────────────────────────────────────────────

function formatMoney(minor: number | null, currency = "INR"): string {
  if (minor === null) return "–";
  const major = Math.abs(minor) / 100;
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

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parts = isoDate.split("-").map(Number);
  const due = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function formatDisplayDate(isoDate: string): string {
  const parts = isoDate.split("-").map(Number);
  const d = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function recurrenceLabel(interval: string): string {
  const map: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Fortnightly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Annually",
    irregular: "Irregular",
  };
  return map[interval] ?? interval;
}

// ── Pay Bill Modal ─────────────────────────────────────────────────────────────

interface PayModalProps {
  bill: BillPredictionJSON;
  accounts: AccountJSON[];
  categories: CategoryJSON[];
  onClose: () => void;
  onPaid: () => void;
  accessToken: string;
}

function PayBillModal({ bill, accounts, categories, onClose, onPaid, accessToken }: PayModalProps) {
  const t = useTheme();
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id ?? "");
  const [selectedCategoryId, setSelectedCategoryId] = useState(bill.category_id ?? categories[0]?.id ?? "");
  const [amountStr, setAmountStr] = useState(
    bill.expected_amount_minor ? String(Math.abs(bill.expected_amount_minor) / 100) : "",
  );
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spendableAccounts = accounts.filter((a) => !a.is_archived && (a.type === "bank" || a.type === "cash" || a.type === "credit_card"));

  async function handlePay() {
    const amountMinor = majorToMinor(amountStr);
    if (amountMinor <= 0) { setError("Enter a valid amount."); return; }
    if (!selectedAccountId) { setError("Select an account."); return; }
    if (!selectedCategoryId) { setError("Select a category."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Enter a valid date (YYYY-MM-DD)."); return; }

    setSaving(true);
    setError(null);
    try {
      await api.markBillPaid({
        action: "mark_paid",
        prediction_id: bill.id,
        account_id: selectedAccountId,
        category_id: selectedCategoryId,
        amount_minor: amountMinor,
        occurred_at: date,
        merchant: bill.name,
      }, accessToken);
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as paid.");
    } finally {
      setSaving(false);
    }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
    title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: t.text, marginBottom: 4 },
    subtitle: { fontSize: typography.size.sm, color: t.textMuted, marginBottom: 20 },
    label: { fontSize: typography.size.sm, color: t.textMuted, marginBottom: 6, fontWeight: typography.weight.medium },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: typography.size.md, color: t.text, backgroundColor: t.background, marginBottom: 14 },
    row: { flexDirection: "row", gap: 12, marginBottom: 14 },
    halfInput: { flex: 1 },
    error: { color: "#EF4444", fontSize: typography.size.sm, marginBottom: 12 },
    btn: { backgroundColor: t.primary, borderRadius: 12, padding: 14, alignItems: "center" },
    btnText: { color: "#fff", fontWeight: typography.weight.semibold, fontSize: typography.size.md },
    cancelBtn: { padding: 14, alignItems: "center", marginTop: 8 },
    cancelText: { color: t.textMuted, fontSize: typography.size.md },
    scrollPicker: { maxHeight: 120, borderWidth: 1, borderColor: t.border, borderRadius: 10, marginBottom: 14 },
    pickerItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: t.border },
    pickerItemSelected: { backgroundColor: t.primary + "20" },
    pickerItemText: { fontSize: typography.size.sm, color: t.text },
    pickerItemTextSelected: { color: t.primary, fontWeight: typography.weight.medium },
  });

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <Text style={s.title}>Pay: {bill.name}</Text>
          <Text style={s.subtitle}>
            Due {formatDisplayDate(bill.expected_date)} · {recurrenceLabel(bill.recurrence_interval)}
          </Text>

          <Text style={s.label}>Amount</Text>
          <TextInput
            style={s.input}
            value={amountStr}
            onChangeText={setAmountStr}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={t.textMuted}
          />

          <Text style={s.label}>Date Paid</Text>
          <TextInput
            style={s.input}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={t.textMuted}
          />

          <Text style={s.label}>Account</Text>
          <ScrollView style={s.scrollPicker} showsVerticalScrollIndicator={false}>
            {spendableAccounts.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[s.pickerItem, a.id === selectedAccountId && s.pickerItemSelected]}
                onPress={() => setSelectedAccountId(a.id)}
              >
                <Text style={[s.pickerItemText, a.id === selectedAccountId && s.pickerItemTextSelected]}>
                  {a.name} ({formatMoney(a.balance_minor, a.currency)})
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={s.label}>Category</Text>
          <ScrollView style={s.scrollPicker} showsVerticalScrollIndicator={false}>
            {categories.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[s.pickerItem, c.id === selectedCategoryId && s.pickerItemSelected]}
                onPress={() => setSelectedCategoryId(c.id)}
              >
                <Text style={[s.pickerItemText, c.id === selectedCategoryId && s.pickerItemTextSelected]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity style={s.btn} onPress={handlePay} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Mark as Paid</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Add Bill Modal ─────────────────────────────────────────────────────────────

interface AddBillModalProps {
  categories: CategoryJSON[];
  onClose: () => void;
  onCreated: () => void;
  accessToken: string;
}

function AddBillModal({ categories, onClose, onCreated, accessToken }: AddBillModalProps) {
  const t = useTheme();
  const [name, setName] = useState("");
  const [interval, setInterval] = useState<"weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular">("monthly");
  const [amountStr, setAmountStr] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const INTERVALS = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"] as const;

  async function handleCreate() {
    if (!name.trim()) { setError("Enter a bill name."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.createBill({
        merchant_pattern: name.trim(),
        recurrence_interval: interval,
        expected_amount_minor: amountStr ? majorToMinor(amountStr) : null,
        category_id: categoryId || null,
      }, accessToken);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bill.");
    } finally {
      setSaving(false);
    }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
    title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: t.text, marginBottom: 20 },
    label: { fontSize: typography.size.sm, color: t.textMuted, marginBottom: 6, fontWeight: typography.weight.medium },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: typography.size.md, color: t.text, backgroundColor: t.background, marginBottom: 14 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
    chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: t.border, backgroundColor: t.background },
    chipSelected: { backgroundColor: t.primary, borderColor: t.primary },
    chipText: { fontSize: typography.size.sm, color: t.text },
    chipTextSelected: { color: "#fff" },
    error: { color: "#EF4444", fontSize: typography.size.sm, marginBottom: 12 },
    btn: { backgroundColor: t.primary, borderRadius: 12, padding: 14, alignItems: "center" },
    btnText: { color: "#fff", fontWeight: typography.weight.semibold, fontSize: typography.size.md },
    cancelBtn: { padding: 14, alignItems: "center", marginTop: 8 },
    cancelText: { color: t.textMuted, fontSize: typography.size.md },
  });

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={s.overlay}>
        <ScrollView style={s.sheet} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>Add Bill</Text>

          <Text style={s.label}>Bill Name / Merchant</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Netflix, Electricity"
            placeholderTextColor={t.textMuted}
            autoFocus
          />

          <Text style={s.label}>Frequency</Text>
          <View style={s.chipRow}>
            {INTERVALS.map((i) => (
              <TouchableOpacity
                key={i}
                style={[s.chip, i === interval && s.chipSelected]}
                onPress={() => setInterval(i)}
              >
                <Text style={[s.chipText, i === interval && s.chipTextSelected]}>
                  {recurrenceLabel(i)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Expected Amount (optional)</Text>
          <TextInput
            style={s.input}
            value={amountStr}
            onChangeText={setAmountStr}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={t.textMuted}
          />

          {categories.length > 0 && (
            <>
              <Text style={s.label}>Category</Text>
              <ScrollView style={{ maxHeight: 100, borderWidth: 1, borderColor: t.border, borderRadius: 10, marginBottom: 14 }}>
                {categories.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: c.id === categoryId ? t.primary + "20" : "transparent" }}
                    onPress={() => setCategoryId(c.id)}
                  >
                    <Text style={{ fontSize: typography.size.sm, color: c.id === categoryId ? t.primary : t.text }}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity style={s.btn} onPress={handleCreate} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Add Bill</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Edit Bill Modal ──────────────────────────────────────────────────────────

interface EditBillModalProps {
  bill: BillPredictionJSON;
  categories: CategoryJSON[];
  onClose: () => void;
  onUpdated: () => void;
  accessToken: string;
}

function EditBillModal({ bill, categories, onClose, onUpdated, accessToken }: EditBillModalProps) {
  const t = useTheme();
  const [name, setName] = useState(bill.name);
  const [interval, setInterval] = useState<"weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular">(
    bill.recurrence_interval as "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular",
  );
  const [amountStr, setAmountStr] = useState(
    bill.expected_amount_minor ? String(Math.abs(bill.expected_amount_minor) / 100) : "",
  );
  const [categoryId, setCategoryId] = useState<string | null>(bill.category_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const INTERVALS = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"] as const;

  async function handleUpdate() {
    if (!name.trim()) { setError("Enter a bill name."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.updateBill({
        bill_id: bill.definition_id,
        merchant_pattern: name.trim(),
        recurrence_interval: interval,
        expected_amount_minor: amountStr ? majorToMinor(amountStr) : null,
        category_id: categoryId,
      }, accessToken);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update bill.");
    } finally {
      setSaving(false);
    }
  }

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    sheet: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
    title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: t.text, marginBottom: 20 },
    label: { fontSize: typography.size.sm, color: t.textMuted, marginBottom: 6, fontWeight: typography.weight.medium },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: typography.size.md, color: t.text, backgroundColor: t.background, marginBottom: 14 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
    chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: t.border, backgroundColor: t.background },
    chipSelected: { backgroundColor: t.primary, borderColor: t.primary },
    chipText: { fontSize: typography.size.sm, color: t.text },
    chipTextSelected: { color: "#fff" },
    error: { color: "#EF4444", fontSize: typography.size.sm, marginBottom: 12 },
    btn: { backgroundColor: t.primary, borderRadius: 12, padding: 14, alignItems: "center" },
    btnText: { color: "#fff", fontWeight: typography.weight.semibold, fontSize: typography.size.md },
    cancelBtn: { padding: 14, alignItems: "center", marginTop: 8 },
    cancelText: { color: t.textMuted, fontSize: typography.size.md },
  });

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={s.overlay}>
        <ScrollView style={s.sheet} keyboardShouldPersistTaps="handled">
          <Text style={s.title}>Edit Bill</Text>

          <Text style={s.label}>Bill Name / Merchant</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Netflix, Electricity"
            placeholderTextColor={t.textMuted}
            autoFocus
          />

          <Text style={s.label}>Frequency</Text>
          <View style={s.chipRow}>
            {INTERVALS.map((i) => (
              <TouchableOpacity
                key={i}
                style={[s.chip, i === interval && s.chipSelected]}
                onPress={() => setInterval(i)}
              >
                <Text style={[s.chipText, i === interval && s.chipTextSelected]}>
                  {recurrenceLabel(i)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Expected Amount (optional)</Text>
          <TextInput
            style={s.input}
            value={amountStr}
            onChangeText={setAmountStr}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={t.textMuted}
          />

          {categories.length > 0 && (
            <>
              <Text style={s.label}>Category</Text>
              <ScrollView style={{ maxHeight: 100, borderWidth: 1, borderColor: t.border, borderRadius: 10, marginBottom: 14 }}>
                {categories.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: c.id === categoryId ? t.primary + "20" : "transparent" }}
                    onPress={() => setCategoryId(c.id)}
                  >
                    <Text style={{ fontSize: typography.size.sm, color: c.id === categoryId ? t.primary : t.text }}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TouchableOpacity style={s.btn} onPress={handleUpdate} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Save Changes</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Bill Row ──────────────────────────────────────────────────────────────────

interface BillRowProps {
  bill: BillPredictionJSON;
  privacyMode: boolean;
  onPay: (bill: BillPredictionJSON) => void;
  onEdit: (bill: BillPredictionJSON) => void;
  onDelete: (bill: BillPredictionJSON) => void;
}

function BillRow({ bill, privacyMode, onPay, onEdit, onDelete }: BillRowProps) {
  const t = useTheme();
  const days = daysUntil(bill.expected_date);
  const isPaid = bill.status === "matched";
  const isOverdue = days < 0 && !isPaid;

  let urgencyColor = t.textMuted;
  let urgencyLabel = `Due in ${days} days`;
  if (isPaid) {
    urgencyColor = "#22C55E";
    urgencyLabel = "Paid";
  } else if (isOverdue) {
    urgencyColor = "#EF4444";
    urgencyLabel = `Overdue by ${Math.abs(days)} days`;
  } else if (days === 0) {
    urgencyColor = "#F59E0B";
    urgencyLabel = "Due today";
  } else if (days <= 3) {
    urgencyColor = "#F59E0B";
    urgencyLabel = `Due in ${days} day${days === 1 ? "" : "s"}`;
  }

  const s = StyleSheet.create({
    row: {
      backgroundColor: t.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: t.border,
    },
    rowOverdue: { borderColor: "#EF4444" + "40" },
    info: { flex: 1, marginRight: 8 },
    name: { fontSize: typography.size.md, fontWeight: typography.weight.medium, color: t.text, marginBottom: 2 },
    namePaid: { color: t.textMuted, textDecorationLine: "line-through" },
    meta: { fontSize: typography.size.xs, color: t.textMuted, marginTop: 2 },
    urgency: { fontSize: typography.size.xs, fontWeight: typography.weight.medium, marginTop: 3 },
    amount: { fontSize: typography.size.md, fontWeight: typography.weight.semibold, color: t.text, marginBottom: 6, textAlign: "right" },
    amountMasked: { color: t.textMuted },
    payBtn: {
      backgroundColor: t.primary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    payBtnText: { color: "#fff", fontSize: typography.size.xs, fontWeight: typography.weight.semibold },
    deleteBtn: {
      marginLeft: 8,
      padding: 6,
    },
    deleteBtnText: { fontSize: 18, color: t.textMuted },
    paidBadge: {
      backgroundColor: "#22C55E20",
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    paidBadgeText: { color: "#22C55E", fontSize: typography.size.xs, fontWeight: typography.weight.medium },
  });

  return (
    <View style={[s.row, isOverdue && s.rowOverdue]}>
      <View style={s.info}>
        <Text style={[s.name, isPaid && s.namePaid]}>{bill.name}</Text>
        <Text style={s.meta}>
          {formatDisplayDate(bill.expected_date)} · {recurrenceLabel(bill.recurrence_interval)}
        </Text>
        <Text style={[s.urgency, { color: urgencyColor }]}>{urgencyLabel}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.amount, privacyMode && s.amountMasked]}>
          {privacyMode ? "••••" : formatMoney(bill.expected_amount_minor, bill.currency)}
        </Text>
        {isPaid ? (
          <View style={s.paidBadge}>
            <Text style={s.paidBadgeText}>Paid</Text>
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TouchableOpacity style={s.payBtn} onPress={() => onPay(bill)}>
              <Text style={s.payBtnText}>Pay</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.deleteBtn} onPress={() => onEdit(bill)} accessibilityLabel="Edit bill">
              <Text style={[s.deleteBtnText, { fontSize: 16 }]}>✏️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.deleteBtn} onPress={() => onDelete(bill)}>
              <Text style={s.deleteBtnText}>×</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function UpcomingScreen() {
  const { session, profile: authProfile } = useAuth();
  const t = useTheme();
  const accessToken = session?.access_token ?? "";

  const [bills, setBills] = useState<BillPredictionJSON[]>([]);
  const [accounts, setAccounts] = useState<AccountJSON[]>([]);
  const [categories, setCategories] = useState<CategoryJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"upcoming" | "all">("upcoming");
  const [showAddModal, setShowAddModal] = useState(false);
  const [payingBill, setPayingBill] = useState<BillPredictionJSON | null>(null);
  const [editingBill, setEditingBill] = useState<BillPredictionJSON | null>(null);
  const privacyMode = authProfile?.privacyMode ?? false;

  async function loadData(tab = activeTab) {
    try {
      const [billsRes, accountsRes, categoriesRes] = await Promise.all([
        api.getBills(accessToken, tab),
        api.getAccounts(accessToken),
        api.getCategories(accessToken),
      ]);
      setBills(billsRes.bills);
      setAccounts(accountsRes.accounts);
      setCategories(categoriesRes.categories);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bills.");
    }
  }

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData().finally(() => setLoading(false));
    }, [accessToken]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  async function handleTabChange(tab: "upcoming" | "all") {
    setActiveTab(tab);
    setLoading(true);
    await loadData(tab);
    setLoading(false);
  }

  function handleDeleteBill(bill: BillPredictionJSON) {
    Alert.alert(
      "Delete Bill",
      `Delete "${bill.name}"? This will remove all future predictions.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteBill(bill.definition_id, accessToken);
              await loadData();
            } catch (err) {
              Alert.alert("Error", err instanceof Error ? err.message : "Failed to delete bill.");
            }
          },
        },
      ],
    );
  }

  // ── Total upcoming ─────────────────────────────────────────────────────────

  const upcomingBills = bills.filter((b) => b.status === "open" || b.status === "overdue");
  const totalUpcomingMinor = upcomingBills.reduce((sum, b) => sum + (b.expected_amount_minor ?? 0), 0);

  // ── Styles ─────────────────────────────────────────────────────────────────

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    header: {
      padding: 20,
      paddingTop: 56,
      backgroundColor: t.surface,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: t.text },
    addBtn: {
      backgroundColor: t.primary,
      borderRadius: 20,
      width: 36,
      height: 36,
      justifyContent: "center",
      alignItems: "center",
    },
    addBtnText: { color: "#fff", fontSize: 22, lineHeight: 26 },
    summaryCard: {
      margin: 16,
      padding: 16,
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    summaryLabel: { fontSize: typography.size.sm, color: t.textMuted, marginBottom: 4 },
    summaryAmount: { fontSize: typography.size["2xl"], fontWeight: typography.weight.bold, color: t.text },
    summaryAmountMasked: { color: t.textMuted },
    tabRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    tab: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    tabActive: { backgroundColor: t.primary, borderColor: t.primary },
    tabText: { fontSize: typography.size.sm, color: t.textMuted },
    tabTextActive: { color: "#fff", fontWeight: typography.weight.medium },
    list: { paddingHorizontal: 16, paddingBottom: 32 },
    errorBox: {
      margin: 16,
      padding: 14,
      backgroundColor: "#EF4444" + "15",
      borderRadius: 10,
    },
    errorText: { color: "#EF4444", fontSize: typography.size.sm },
    emptyBox: { alignItems: "center", paddingVertical: 60 },
    emptyIcon: { fontSize: 48, marginBottom: 12 },
    emptyTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: t.text, marginBottom: 6 },
    emptyText: { fontSize: typography.size.sm, color: t.textMuted, textAlign: "center", paddingHorizontal: 32 },
  });

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerRow}>
          <Text style={s.title}>Upcoming</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => setShowAddModal(true)}>
            <Text style={s.addBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary card */}
      {upcomingBills.length > 0 && (
        <View style={s.summaryCard}>
          <Text style={s.summaryLabel}>Total Upcoming ({upcomingBills.length} bill{upcomingBills.length === 1 ? "" : "s"})</Text>
          <Text style={[s.summaryAmount, privacyMode && s.summaryAmountMasked]}>
            {privacyMode ? "••••" : formatMoney(totalUpcomingMinor)}
          </Text>
        </View>
      )}

      {/* Tabs */}
      <View style={s.tabRow}>
        {(["upcoming", "all"] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[s.tab, activeTab === tab && s.tabActive]}
            onPress={() => handleTabChange(tab)}
          >
            <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
              {tab === "upcoming" ? "Upcoming" : "All Bills"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Error */}
      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={t.primary} size="large" />
        </View>
      ) : bills.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyIcon}>📅</Text>
          <Text style={s.emptyTitle}>No bills yet</Text>
          <Text style={s.emptyText}>
            Add recurring bills to track upcoming payments and deduct them from your Safe-to-Spend.
          </Text>
        </View>
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BillRow
              bill={item}
              privacyMode={privacyMode}
              onPay={setPayingBill}
              onEdit={setEditingBill}
              onDelete={handleDeleteBill}
            />
          )}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={t.primary} />
          }
        />
      )}

      {/* Add Bill Modal */}
      {showAddModal && (
        <AddBillModal
          categories={categories}
          accessToken={accessToken}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            loadData();
          }}
        />
      )}

      {/* Pay Bill Modal */}
      {payingBill && (
        <PayBillModal
          bill={payingBill}
          accounts={accounts}
          categories={categories}
          accessToken={accessToken}
          onClose={() => setPayingBill(null)}
          onPaid={() => {
            setPayingBill(null);
            loadData();
          }}
        />
      )}

      {/* Edit Bill Modal */}
      {editingBill && (
        <EditBillModal
          bill={editingBill}
          categories={categories}
          accessToken={accessToken}
          onClose={() => setEditingBill(null)}
          onUpdated={() => {
            setEditingBill(null);
            loadData();
          }}
        />
      )}
    </View>
  );
}
