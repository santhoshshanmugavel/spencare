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
  type GoalDetailJSON,
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

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Progress helpers ──────────────────────────────────────────────────────────

export function calcPercent(saved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((saved / target) * 100));
}

// ── Pace status ───────────────────────────────────────────────────────────────

type PaceStatus = "on_track" | "at_risk" | "behind" | "no_deadline" | "completed" | "overdue";

function computePaceStatus(goal: GoalDetailJSON): PaceStatus {
  if (goal.status === "completed") return "completed";
  if (!goal.target_date) return "no_deadline";

  const now = Date.now();
  const createdMs = new Date(goal.created_at).getTime();
  const targetMs = new Date(goal.target_date).getTime();

  if (now >= targetMs) return "overdue";

  const totalDuration = targetMs - createdMs;
  if (totalDuration <= 0) return "no_deadline";

  const elapsed = now - createdMs;
  const timePercent = Math.round((elapsed / totalDuration) * 100);
  const progressPercent = calcPercent(goal.saved_amount_minor, goal.target_amount_minor);

  const gap = timePercent - progressPercent;
  if (gap <= 0) return "on_track";
  if (gap <= 15) return "at_risk";
  return "behind";
}

const PACE_LABEL: Record<PaceStatus, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  behind: "Behind",
  no_deadline: "No Deadline",
  completed: "Done",
  overdue: "Overdue",
};

const PACE_COLORS: Record<PaceStatus, { color: string; bg: string }> = {
  on_track: { color: "#16A34A", bg: "#DCFCE7" },
  at_risk: { color: "#D97706", bg: "#FEF3C7" },
  behind: { color: "#DC2626", bg: "#FEE2E2" },
  no_deadline: { color: "#6B7280", bg: "#F3F4F6" },
  completed: { color: "#16A34A", bg: "#DCFCE7" },
  overdue: { color: "#DC2626", bg: "#FEE2E2" },
};

// ── Account filtering ─────────────────────────────────────────────────────────

/** Only bank, cash, and investment accounts can fund goals (not credit cards). */
export function isGoalFundingEligible(account: AccountJSON): boolean {
  return !account.is_archived && (
    account.type === "bank" ||
    account.type === "cash" ||
    account.type === "investment"
  );
}

// ── GoalCard ──────────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  privacyMode,
  onContribute,
  onWithdraw,
  onEdit,
  onArchive,
}: {
  goal: GoalDetailJSON;
  privacyMode: boolean;
  onContribute: (g: GoalDetailJSON) => void;
  onWithdraw: (g: GoalDetailJSON) => void;
  onEdit: (g: GoalDetailJSON) => void;
  onArchive: (g: GoalDetailJSON) => void;
}) {
  const percent = calcPercent(goal.saved_amount_minor, goal.target_amount_minor);
  const isCompleted = goal.status === "completed";
  const isArchived = goal.status === "archived";
  const paceStatus = computePaceStatus(goal);
  const showPaceBadge = !isArchived && paceStatus !== "completed";

  const savedDisplay = privacyMode ? "₹ ••••" : formatMoney(goal.saved_amount_minor);
  const targetDisplay = privacyMode ? "₹ ••••" : formatMoney(goal.target_amount_minor);

  function handleLongPress() {
    const actions: { text: string; style?: "destructive" | "cancel" | "default"; onPress?: () => void }[] = [];
    if (!isArchived && !isCompleted) {
      actions.push({ text: "Add contribution", onPress: () => onContribute(goal) });
      if (goal.saved_amount_minor > 0) {
        actions.push({ text: "Withdraw funds", onPress: () => onWithdraw(goal) });
      }
      actions.push({ text: "Edit goal", onPress: () => onEdit(goal) });
    }
    if (!isArchived) {
      actions.push({ text: "Archive goal", style: "destructive", onPress: () => onArchive(goal) });
    }
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert(goal.name, "What would you like to do?", actions);
  }

  return (
    <TouchableOpacity
      style={[styles.card, isArchived && styles.cardArchived]}
      onLongPress={handleLongPress}
      delayLongPress={400}
      accessibilityLabel={`${goal.name}, ${percent}% saved. Long press for actions.`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardTitle, isArchived && styles.cardTitleArchived]} numberOfLines={1}>
            {goal.name}
          </Text>
          {isCompleted && <Text style={styles.badgeCompleted}>Done</Text>}
          {isArchived && <Text style={styles.badgeArchived}>Archived</Text>}
          {showPaceBadge && (
            <Text style={[styles.badgeArchived, { color: PACE_COLORS[paceStatus].color, backgroundColor: PACE_COLORS[paceStatus].bg }]}>
              {PACE_LABEL[paceStatus]}
            </Text>
          )}
        </View>
        {goal.target_date && (
          <Text style={styles.cardDate}>By {formatDate(goal.target_date)}</Text>
        )}
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` as `${number}%` }, isCompleted && styles.progressFillCompleted]} />
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.cardSaved}>{savedDisplay}</Text>
        <Text style={styles.cardPercent}>{percent}%</Text>
        <Text style={styles.cardTarget}>of {targetDisplay}</Text>
      </View>

      {!isArchived && !isCompleted && (
        <TouchableOpacity
          style={styles.contributeBtn}
          onPress={() => onContribute(goal)}
          accessibilityLabel={`Add contribution to ${goal.name}`}
        >
          <Text style={styles.contributeBtnText}>+ Contribute</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ── CreateGoalModal ───────────────────────────────────────────────────────────

function CreateGoalModal({
  visible,
  onClose,
  onSaved,
  accounts,
  accessToken,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: AccountJSON[];
  accessToken: string;
}) {
  const [name, setName] = useState("");
  const [targetText, setTargetText] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [term, setTerm] = useState<"short" | "long">("short");
  const [initialSavedText, setInitialSavedText] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = accounts.filter(isGoalFundingEligible);

  useEffect(() => {
    if (visible) {
      setName("");
      setTargetText("");
      setTargetDate("");
      setTerm("short");
      setInitialSavedText("");
      setSelectedAccountId(eligibleAccounts.length > 0 ? eligibleAccounts[0].id : null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function handleSave() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Enter a goal name."); return; }
    if (trimmedName.length > 120) { setError("Name must be 120 characters or fewer."); return; }

    const targetMinor = majorToMinor(targetText);
    if (targetMinor <= 0) { setError("Enter a target amount greater than zero."); return; }

    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setError("Target date must be YYYY-MM-DD format.");
      return;
    }

    if (!selectedAccountId) { setError("Select a funding account."); return; }

    const initialMinor = initialSavedText ? majorToMinor(initialSavedText) : undefined;

    setSaving(true);
    try {
      await api.createGoal(
        {
          name: trimmedName,
          target_amount_minor: targetMinor,
          target_date: targetDate || null,
          funding_account_id: selectedAccountId,
          term,
          initial_saved_amount_minor: initialMinor,
        },
        accessToken,
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create goal.");
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
          <Text style={styles.modalTitle}>New Goal</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            <Text style={[styles.modalSaveText, saving && styles.dimmed]}>
              {saving ? "Saving…" : "Create"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Goal name</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Emergency Fund"
              value={name}
              onChangeText={setName}
              maxLength={120}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Target amount (₹)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={targetText}
              onChangeText={setTargetText}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Target date (YYYY-MM-DD, optional)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="2027-12-31"
              value={targetDate}
              onChangeText={setTargetDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Term</Text>
            {(["short", "long"] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.pickerRow, term === t && styles.pickerRowSelected]}
                onPress={() => setTerm(t)}
              >
                <Text style={[styles.pickerRowText, term === t && styles.pickerRowTextSelected]}>
                  {t === "short" ? "Short term" : "Long term"}
                </Text>
                {term === t && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Already saved (₹, optional)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={initialSavedText}
              onChangeText={setInitialSavedText}
            />
            <Text style={styles.formHint}>
              Records how much you've already set aside. This does not debit any account.
            </Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Funding account</Text>
            {eligibleAccounts.length === 0 ? (
              <Text style={styles.emptyPicker}>No eligible accounts. Add a bank or cash account first.</Text>
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

          {error && <Text style={styles.formError}>{error}</Text>}
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── EditGoalModal ─────────────────────────────────────────────────────────────

function EditGoalModal({
  visible,
  goal,
  onClose,
  onSaved,
  accounts,
  accessToken,
}: {
  visible: boolean;
  goal: GoalDetailJSON;
  onClose: () => void;
  onSaved: () => void;
  accounts: AccountJSON[];
  accessToken: string;
}) {
  const [name, setName] = useState(goal.name);
  const [targetText, setTargetText] = useState(minorToMajor(goal.target_amount_minor).toFixed(2));
  const [targetDate, setTargetDate] = useState(goal.target_date ?? "");
  const [term, setTerm] = useState<"short" | "long">(goal.term);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(goal.funding_account_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = accounts.filter(isGoalFundingEligible);

  useEffect(() => {
    if (visible) {
      setName(goal.name);
      setTargetText(minorToMajor(goal.target_amount_minor).toFixed(2));
      setTargetDate(goal.target_date ?? "");
      setTerm(goal.term);
      setSelectedAccountId(goal.funding_account_id);
      setError(null);
    }
  }, [visible, goal]);

  async function handleSave() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) { setError("Enter a goal name."); return; }

    const targetMinor = majorToMinor(targetText);
    if (targetMinor <= 0) { setError("Enter a target amount greater than zero."); return; }

    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setError("Target date must be YYYY-MM-DD format.");
      return;
    }

    if (!selectedAccountId) { setError("Select a funding account."); return; }

    setSaving(true);
    try {
      await api.updateGoal(
        {
          goal_id: goal.id,
          name: trimmedName,
          target_amount_minor: targetMinor,
          target_date: targetDate || null,
          funding_account_id: selectedAccountId,
          term,
        },
        accessToken,
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update goal.");
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
          <Text style={styles.modalTitle}>Edit Goal</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            <Text style={[styles.modalSaveText, saving && styles.dimmed]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Goal name</Text>
            <TextInput
              style={styles.formInput}
              placeholder="e.g. Emergency Fund"
              value={name}
              onChangeText={setName}
              maxLength={120}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Target amount (₹)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={targetText}
              onChangeText={setTargetText}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Target date (YYYY-MM-DD, optional)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="2027-12-31"
              value={targetDate}
              onChangeText={setTargetDate}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Term</Text>
            {(["short", "long"] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.pickerRow, term === t && styles.pickerRowSelected]}
                onPress={() => setTerm(t)}
              >
                <Text style={[styles.pickerRowText, term === t && styles.pickerRowTextSelected]}>
                  {t === "short" ? "Short term" : "Long term"}
                </Text>
                {term === t && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Funding account</Text>
            {eligibleAccounts.length === 0 ? (
              <Text style={styles.emptyPicker}>No eligible accounts.</Text>
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

          {error && <Text style={styles.formError}>{error}</Text>}
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── ContributeModal ───────────────────────────────────────────────────────────

function ContributeModal({
  visible,
  goal,
  onClose,
  onSaved,
  accounts,
  accessToken,
}: {
  visible: boolean;
  goal: GoalDetailJSON;
  onClose: () => void;
  onSaved: (updatedGoal: GoalDetailJSON | null) => void;
  accounts: AccountJSON[];
  accessToken: string;
}) {
  const [amountText, setAmountText] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = accounts.filter(isGoalFundingEligible);

  useEffect(() => {
    if (visible) {
      setAmountText("");
      setSelectedAccountId(
        eligibleAccounts.find((a) => a.id === goal.funding_account_id)?.id ??
        (eligibleAccounts.length > 0 ? eligibleAccounts[0].id : null)
      );
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, goal.funding_account_id]);

  async function handleSave() {
    setError(null);
    const amountMinor = majorToMinor(amountText);
    if (amountMinor <= 0) { setError("Enter a contribution amount greater than zero."); return; }
    if (!selectedAccountId) { setError("Select an account."); return; }

    setSaving(true);
    try {
      const res = await api.addContribution(
        {
          goal_id: goal.id,
          account_id: selectedAccountId,
          amount_minor: amountMinor,
        },
        accessToken,
      );
      onSaved(res.goal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record contribution.");
    } finally {
      setSaving(false);
    }
  }

  const remaining = Math.max(0, goal.target_amount_minor - goal.saved_amount_minor);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalWrapper} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCancelBtn}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Contribute</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            <Text style={[styles.modalSaveText, saving && styles.dimmed]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <View style={styles.contributeGoalInfo}>
            <Text style={styles.contributeGoalName}>{goal.name}</Text>
            <Text style={styles.contributeGoalRemaining}>
              Remaining: {formatMoney(remaining)}
            </Text>
          </View>

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

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>From account</Text>
            {eligibleAccounts.length === 0 ? (
              <Text style={styles.emptyPicker}>No eligible accounts.</Text>
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

          {error && <Text style={styles.formError}>{error}</Text>}
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── WithdrawModal ─────────────────────────────────────────────────────────────

function WithdrawModal({
  visible,
  goal,
  onClose,
  onSaved,
  accounts,
  accessToken,
}: {
  visible: boolean;
  goal: GoalDetailJSON;
  onClose: () => void;
  onSaved: (updatedGoal: GoalDetailJSON | null) => void;
  accounts: AccountJSON[];
  accessToken: string;
}) {
  const [amountText, setAmountText] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleAccounts = accounts.filter(isGoalFundingEligible);

  useEffect(() => {
    if (visible) {
      setAmountText("");
      setSelectedAccountId(
        eligibleAccounts.find((a) => a.id === goal.funding_account_id)?.id ??
        (eligibleAccounts.length > 0 ? eligibleAccounts[0].id : null)
      );
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, goal.funding_account_id]);

  async function handleSave() {
    setError(null);
    const amountMinor = majorToMinor(amountText);
    if (amountMinor <= 0) { setError("Enter a withdrawal amount greater than zero."); return; }
    if (amountMinor > goal.saved_amount_minor) {
      setError("Withdrawal cannot exceed the saved amount.");
      return;
    }
    if (!selectedAccountId) { setError("Select an account."); return; }

    setSaving(true);
    try {
      const res = await api.withdrawGoal(
        {
          goal_id: goal.id,
          account_id: selectedAccountId,
          amount_minor: amountMinor,
        },
        accessToken,
      );
      onSaved(res.goal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record withdrawal.");
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
          <Text style={styles.modalTitle}>Withdraw</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSaveBtn} disabled={saving}>
            <Text style={[styles.modalSaveText, saving && styles.dimmed]}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <View style={styles.contributeGoalInfo}>
            <Text style={styles.contributeGoalName}>{goal.name}</Text>
            <Text style={styles.contributeGoalRemaining}>
              Saved: {formatMoney(goal.saved_amount_minor)}
            </Text>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>Amount to withdraw (₹)</Text>
            <TextInput
              style={styles.formInput}
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={amountText}
              onChangeText={setAmountText}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.formLabel}>To account</Text>
            {eligibleAccounts.length === 0 ? (
              <Text style={styles.emptyPicker}>No eligible accounts.</Text>
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

          {error && <Text style={styles.formError}>{error}</Text>}
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── GoalsScreen ───────────────────────────────────────────────────────────────

export default function GoalsScreen() {
  const { session } = useAuth();
  const [goals, setGoals] = useState<GoalDetailJSON[]>([]);
  const [accounts, setAccounts] = useState<AccountJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalDetailJSON | null>(null);
  const [contributingGoal, setContributingGoal] = useState<GoalDetailJSON | null>(null);
  const [withdrawingGoal, setWithdrawingGoal] = useState<GoalDetailJSON | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!session) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [goalsRes, accountsRes, pmRes] = await Promise.all([
        api.getGoals(session.accessToken, "all"),
        api.getAccounts(session.accessToken),
        api.getPrivacyMode(session.accessToken),
      ]);
      setGoals(goalsRes.goals);
      setAccounts(accountsRes.accounts);
      setPrivacyMode(pmRes.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load goals.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  function handleArchive(goal: GoalDetailJSON) {
    Alert.alert(
      "Archive goal?",
      `"${goal.name}" will be archived. You can view it in the archived section.`,
      [
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            try {
              await api.archiveGoal(goal.id, session!.accessToken);
              load(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to archive goal.");
            }
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

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

  const activeGoals = goals.filter((g) => g.status === "active" || g.status === "completed");
  const archivedGoals = goals.filter((g) => g.status === "archived");

  const visibleGoals = showArchived ? goals : activeGoals;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.screenTitle}>Goals</Text>
        {archivedGoals.length > 0 && (
          <TouchableOpacity onPress={() => setShowArchived(!showArchived)} style={styles.archivedToggle}>
            <Text style={styles.archivedToggleText}>
              {showArchived ? "Hide archived" : `Archived (${archivedGoals.length})`}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {visibleGoals.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {showArchived && archivedGoals.length === 0 ? "No archived goals." : "No goals yet."}
          </Text>
          {!showArchived && (
            <Text style={styles.emptySub}>
              Create your first savings goal to get started.
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={visibleGoals}
          keyExtractor={(g) => g.id}
          renderItem={({ item }) => (
            <GoalCard
              goal={item}
              privacyMode={privacyMode}
              onContribute={(g) => setContributingGoal(g)}
              onWithdraw={(g) => setWithdrawingGoal(g)}
              onEdit={(g) => setEditingGoal(g)}
              onArchive={handleArchive}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7C3AED" />
          }
          contentContainerStyle={styles.list}
        />
      )}

      {/* FAB */}
      <Pressable
        style={styles.fab}
        onPress={() => setShowCreate(true)}
        accessibilityLabel="Add goal"
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      {showCreate && (
        <CreateGoalModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            load(true);
          }}
          accounts={accounts}
          accessToken={session?.accessToken ?? ""}
        />
      )}

      {editingGoal && (
        <EditGoalModal
          visible={true}
          goal={editingGoal}
          onClose={() => setEditingGoal(null)}
          onSaved={() => {
            setEditingGoal(null);
            load(true);
          }}
          accounts={accounts}
          accessToken={session?.accessToken ?? ""}
        />
      )}

      {contributingGoal && (
        <ContributeModal
          visible={true}
          goal={contributingGoal}
          onClose={() => setContributingGoal(null)}
          onSaved={(updatedGoal) => {
            setContributingGoal(null);
            if (updatedGoal) {
              setGoals((prev) => prev.map((g) => (g.id === updatedGoal.id ? updatedGoal : g)));
            } else {
              load(true);
            }
          }}
          accounts={accounts}
          accessToken={session?.accessToken ?? ""}
        />
      )}

      {withdrawingGoal && (
        <WithdrawModal
          visible={true}
          goal={withdrawingGoal}
          onClose={() => setWithdrawingGoal(null)}
          onSaved={(updatedGoal) => {
            setWithdrawingGoal(null);
            if (updatedGoal) {
              setGoals((prev) => prev.map((g) => (g.id === updatedGoal.id ? updatedGoal : g)));
            } else {
              load(true);
            }
          }}
          accounts={accounts}
          accessToken={session?.accessToken ?? ""}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    backgroundColor: "#F5F5F5",
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111",
  },
  archivedToggle: { padding: 4 },
  archivedToggleText: { fontSize: 13, color: "#7C3AED", fontWeight: "600" },
  list: { paddingHorizontal: 16, paddingBottom: 96 },
  errorText: { fontSize: 15, color: "#DC2626", textAlign: "center" },
  emptyText: { fontSize: 17, fontWeight: "600", color: "#333", textAlign: "center" },
  emptySub: { fontSize: 14, color: "#888", textAlign: "center", marginTop: 8 },
  // Goal card
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardArchived: { opacity: 0.6 },
  cardHeader: { marginBottom: 12 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111", flex: 1 },
  cardTitleArchived: { color: "#888" },
  badgeCompleted: {
    fontSize: 11,
    fontWeight: "700",
    color: "#16A34A",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeArchived: {
    fontSize: 11,
    fontWeight: "700",
    color: "#888",
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  cardDate: { fontSize: 12, color: "#888", marginTop: 4 },
  progressTrack: {
    height: 6,
    backgroundColor: "#E5E7EB",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 10,
  },
  progressFill: {
    height: 6,
    backgroundColor: "#7C3AED",
    borderRadius: 3,
  },
  progressFillCompleted: { backgroundColor: "#16A34A" },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardSaved: { fontSize: 14, fontWeight: "700", color: "#111" },
  cardPercent: { fontSize: 12, color: "#7C3AED", fontWeight: "600" },
  cardTarget: { fontSize: 13, color: "#888", flex: 1 },
  contributeBtn: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#7C3AED",
    paddingVertical: 8,
    alignItems: "center",
  },
  contributeBtnText: { fontSize: 14, color: "#7C3AED", fontWeight: "600" },
  // Contribute info
  contributeGoalInfo: {
    backgroundColor: "#FAF5FF",
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
  },
  contributeGoalName: { fontSize: 16, fontWeight: "700", color: "#111", marginBottom: 4 },
  contributeGoalRemaining: { fontSize: 14, color: "#7C3AED", fontWeight: "600" },
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
  formGroup: { marginBottom: 20, marginTop: 8 },
  formLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
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
  formHint: { fontSize: 12, color: "#999", marginTop: 6 },
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
