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
  type BudgetWithUsageJSON,
  type BudgetStatus,
  type CategoryJSON,
} from "../../lib/api";

// ── Money helpers ─────────────────────────────────────────────────────────────

function formatMoney(minor: number, currency = "INR"): string {
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
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

// ── Period helpers ────────────────────────────────────────────────────────────

export function currentPeriodStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function formatPeriod(periodStart: string): string {
  const [year, month] = periodStart.split("-");
  if (!year || !month) return periodStart;
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

// ── Status helpers ────────────────────────────────────────────────────────────

export function statusColor(status: BudgetStatus): string {
  if (status === "exceeded") return "#ef4444";
  if (status === "near_limit") return "#f59e0b";
  return "#22c55e";
}

export function statusLabel(status: BudgetStatus): string {
  if (status === "exceeded") return "Over budget";
  if (status === "near_limit") return "Near limit";
  return "On track";
}

export function calcPercentClamped(percentUsed: number): number {
  return Math.min(100, Math.max(0, Math.round(percentUsed)));
}

// ── Budget card ───────────────────────────────────────────────────────────────

interface BudgetCardProps {
  budget: BudgetWithUsageJSON;
  categoryName: string | undefined;
  onEdit: () => void;
  onDelete: () => void;
}

function BudgetCard({ budget, categoryName, onEdit, onDelete }: BudgetCardProps) {
  const percent = calcPercentClamped(budget.percentUsed);
  const color = statusColor(budget.status);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{categoryName ?? budget.categoryId}</Text>
        <Text style={[styles.statusBadge, { color }]}>{statusLabel(budget.status)}</Text>
      </View>

      <View style={styles.progressBarTrack}>
        <View style={[styles.progressBarFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>

      <View style={styles.amountsRow}>
        <Text style={styles.amountText}>
          {formatMoney(budget.spentMinor)} spent
        </Text>
        <Text style={styles.amountText}>
          {formatMoney(budget.limitMinor)} limit
        </Text>
      </View>

      <Text style={styles.remainingText}>
        {budget.remainingMinor >= 0
          ? `${formatMoney(budget.remainingMinor)} remaining`
          : `${formatMoney(Math.abs(budget.remainingMinor))} over budget`}
      </Text>

      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.editBtn} onPress={onEdit}>
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function BudgetsScreen() {
  const { session } = useAuth();
  const accessToken = session?.accessToken;
  const [budgets, setBudgets] = useState<BudgetWithUsageJSON[]>([]);
  const [categories, setCategories] = useState<CategoryJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<BudgetWithUsageJSON | null>(null);

  // Create form state
  const [createCategoryId, setCreateCategoryId] = useState("");
  const [createAmount, setCreateAmount] = useState("");
  const [createApplyToUpcoming, setCreateApplyToUpcoming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Edit form state
  const [editAmount, setEditAmount] = useState("");
  const [editApplyToUpcoming, setEditApplyToUpcoming] = useState(false);

  const periodStart = currentPeriodStart();

  const loadData = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [budgetsRes, categoriesRes] = await Promise.all([
        api.getBudgets(accessToken, periodStart),
        api.getCategories(accessToken),
      ]);
      setBudgets(budgetsRes.budgets);
      setCategories(categoriesRes.categories);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load budgets.");
    }
  }, [accessToken, periodStart]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData().finally(() => setLoading(false));
    }, [loadData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  function categoryName(categoryId: string): string | undefined {
    return categories.find((c) => c.id === categoryId)?.name;
  }

  async function handleCreate() {
    if (!accessToken || !createCategoryId || !createAmount) return;
    const amountMinor = majorToMinor(createAmount);
    setSubmitting(true);
    try {
      await api.createBudget(
        {
          category_id: createCategoryId,
          amount_minor: amountMinor,
          period_start: periodStart,
          apply_to_upcoming: createApplyToUpcoming || undefined,
        },
        accessToken,
      );
      setShowCreateModal(false);
      setCreateCategoryId("");
      setCreateAmount("");
      setCreateApplyToUpcoming(false);
      await loadData();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Couldn't create budget.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit() {
    if (!accessToken || !selectedBudget || !editAmount) return;
    const amountMinor = majorToMinor(editAmount);
    setSubmitting(true);
    try {
      await api.updateBudget(
        {
          budget_id: selectedBudget.id,
          amount_minor: amountMinor,
          apply_to_upcoming: editApplyToUpcoming || undefined,
        },
        accessToken,
      );
      setShowEditModal(false);
      setSelectedBudget(null);
      setEditAmount("");
      setEditApplyToUpcoming(false);
      await loadData();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Couldn't update budget.");
    } finally {
      setSubmitting(false);
    }
  }

  function confirmDelete(budget: BudgetWithUsageJSON) {
    Alert.alert(
      "Delete Budget",
      `Delete the ${categoryName(budget.categoryId) ?? "this"} budget? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!accessToken) return;
            try {
              await api.deleteBudget(budget.id, accessToken);
              await loadData();
            } catch (e) {
              Alert.alert("Error", e instanceof Error ? e.message : "Couldn't delete budget.");
            }
          },
        },
      ],
    );
  }

  function openEdit(budget: BudgetWithUsageJSON) {
    setSelectedBudget(budget);
    setEditAmount(String(budget.limitMinor / 100));
    setEditApplyToUpcoming(false);
    setShowEditModal(true);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadData}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Budgets</Text>
          <Text style={styles.headerSubtitle}>{formatPeriod(periodStart)}</Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowCreateModal(true)}
        >
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Budget list */}
      <FlatList
        data={budgets}
        keyExtractor={(b) => b.id}
        contentContainerStyle={budgets.length === 0 ? styles.emptyContainer : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No budgets for this month.</Text>
            <Text style={styles.emptySubtext}>Tap "+ Add" to create one.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <BudgetCard
            budget={item}
            categoryName={categoryName(item.categoryId)}
            onEdit={() => openEdit(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
      />

      {/* Create modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New Budget</Text>
            <Pressable onPress={() => setShowCreateModal(false)}>
              <Text style={styles.modalClose}>Cancel</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryList}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  createCategoryId === cat.id && styles.categoryChipSelected,
                ]}
                onPress={() => setCreateCategoryId(cat.id)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    createCategoryId === cat.id && styles.categoryChipTextSelected,
                  ]}
                >
                  {cat.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Limit amount</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 5000"
            keyboardType="decimal-pad"
            value={createAmount}
            onChangeText={setCreateAmount}
          />

          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setCreateApplyToUpcoming(!createApplyToUpcoming)}
          >
            <View style={[styles.checkbox, createApplyToUpcoming && styles.checkboxChecked]} />
            <Text style={styles.toggleLabel}>Apply to upcoming months</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleCreate}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Create Budget</Text>
            )}
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modal}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Edit Budget
              {selectedBudget ? ` — ${categoryName(selectedBudget.categoryId) ?? ""}` : ""}
            </Text>
            <Pressable onPress={() => setShowEditModal(false)}>
              <Text style={styles.modalClose}>Cancel</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>New limit amount</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 5000"
            keyboardType="decimal-pad"
            value={editAmount}
            onChangeText={setEditAmount}
          />

          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setEditApplyToUpcoming(!editApplyToUpcoming)}
          >
            <View style={[styles.checkbox, editApplyToUpcoming && styles.checkboxChecked]} />
            <Text style={styles.toggleLabel}>Apply to upcoming months</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleEdit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#111827" },
  headerSubtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  addBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  listContent: { padding: 16, gap: 12 },
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#374151", textAlign: "center" },
  emptySubtext: { fontSize: 13, color: "#9ca3af", marginTop: 8, textAlign: "center" },
  errorText: { color: "#ef4444", fontSize: 15, textAlign: "center", marginBottom: 16 },
  retryBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryBtnText: { color: "#fff", fontWeight: "600" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#111827", flex: 1 },
  statusBadge: { fontSize: 12, fontWeight: "600" },
  progressBarTrack: {
    height: 6,
    backgroundColor: "#e5e7eb",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressBarFill: { height: 6, borderRadius: 3 },
  amountsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  amountText: { fontSize: 12, color: "#6b7280" },
  remainingText: { fontSize: 13, fontWeight: "500", color: "#374151", marginBottom: 12 },
  cardActions: { flexDirection: "row", gap: 8 },
  editBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#6366f1",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  editBtnText: { color: "#6366f1", fontWeight: "600", fontSize: 13 },
  deleteBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ef4444",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  deleteBtnText: { color: "#ef4444", fontWeight: "600", fontSize: 13 },

  modal: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 20,
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  modalClose: { color: "#6366f1", fontWeight: "600", fontSize: 15 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 8, marginTop: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#fff",
  },
  categoryList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryChipSelected: { borderColor: "#6366f1", backgroundColor: "#eef2ff" },
  categoryChipText: { fontSize: 13, color: "#374151" },
  categoryChipTextSelected: { color: "#6366f1", fontWeight: "600" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
    marginBottom: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
  },
  checkboxChecked: { backgroundColor: "#6366f1", borderColor: "#6366f1" },
  toggleLabel: { fontSize: 14, color: "#374151" },
  submitBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
