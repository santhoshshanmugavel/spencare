import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { useAuth } from "@/lib/auth";
import { api, type CategoryJSON } from "@/lib/api";
import { useTheme, radius, spacing, typography, type Theme } from "@/lib/theme";

export default function CategoriesScreen(): React.JSX.Element {
  const { session } = useAuth();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);

  const [categories, setCategories] = useState<CategoryJSON[]>([]);
  const [loading, setLoading] = useState(true);

  // Add/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryJSON | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete reassign picker
  const [deleteTarget, setDeleteTarget] = useState<CategoryJSON | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await api.getCategories(session.accessToken);
      setCategories(res.categories);
    } catch {
      Alert.alert("Error", "Couldn't load categories.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = useCallback(() => {
    setEditing(null);
    setNameInput("");
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((cat: CategoryJSON) => {
    setEditing(cat);
    setNameInput(cat.name);
    setModalOpen(true);
  }, []);

  const save = useCallback(async () => {
    if (!session || saving) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      Alert.alert("Error", "Name cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await api.updateCategory(
          { categoryId: editing.id, name: trimmed },
          session.accessToken,
        );
        setCategories((prev) => prev.map((c) => (c.id === editing.id ? res.category : c)));
      } else {
        const res = await api.createCategory({ name: trimmed }, session.accessToken);
        setCategories((prev) => [...prev, res.category]);
      }
      setModalOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't save category.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  }, [session, saving, editing, nameInput]);

  const initiateDelete = useCallback((cat: CategoryJSON) => {
    setDeleteTarget(cat);
    setReassignOpen(true);
  }, []);

  const confirmDelete = useCallback(
    async (reassignTo: CategoryJSON) => {
      if (!session || !deleteTarget) return;
      setReassignOpen(false);
      try {
        await api.deleteCategory(deleteTarget.id, reassignTo.id, session.accessToken);
        setCategories((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Couldn't delete category.";
        Alert.alert("Error", msg);
      } finally {
        setDeleteTarget(null);
      }
    },
    [session, deleteTarget],
  );

  const userCategories = categories.filter((c) => !c.is_system);
  const systemCategories = categories.filter((c) => c.is_system);
  const reassignOptions = categories.filter(
    (c) => c.id !== deleteTarget?.id,
  );

  const renderCategory = ({ item }: { item: CategoryJSON }) => (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        {item.icon ? (
          <Text style={styles.icon}>{item.icon}</Text>
        ) : (
          <View style={[styles.iconPlaceholder, item.is_system && styles.iconPlaceholderSystem]} />
        )}
        <Text style={styles.name}>{item.name}</Text>
        {item.is_system && <Text style={styles.badge}>System</Text>}
      </View>
      {!item.is_system && (
        <View style={styles.rowActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => openEdit(item)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.name}`}
          >
            <Text style={styles.actionBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDelete]}
            onPress={() => initiateDelete(item)}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.name}`}
          >
            <Text style={styles.actionBtnDeleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Categories",
          headerRight: () => (
            <TouchableOpacity onPress={openAdd} accessibilityRole="button" accessibilityLabel="Add category">
              <Text style={{ color: t.primary, fontSize: typography.size.base, fontWeight: typography.weight.semibold }}>
                + Add
              </Text>
            </TouchableOpacity>
          ),
        }}
      />

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={t.primary} />
        </View>
      ) : (
        <FlatList
          data={[
            { type: "header" as const, title: `Your categories (${userCategories.length})` },
            ...userCategories.map((c) => ({ type: "item" as const, item: c })),
            ...(userCategories.length === 0
              ? [{ type: "empty" as const }]
              : []),
            { type: "header" as const, title: `System categories (${systemCategories.length})` },
            ...systemCategories.map((c) => ({ type: "item" as const, item: c })),
          ]}
          keyExtractor={(row, i) =>
            row.type === "item" ? row.item.id : `${row.type}-${i}`
          }
          contentContainerStyle={styles.list}
          renderItem={({ item: row }) => {
            if (row.type === "header") {
              return <Text style={styles.sectionHeader}>{row.title}</Text>;
            }
            if (row.type === "empty") {
              return (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyText}>No custom categories yet.</Text>
                </View>
              );
            }
            return renderCategory({ item: row.item });
          }}
        />
      )}

      {/* Add / Edit modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editing ? "Edit category" : "Add category"}</Text>
            <TextInput
              style={styles.textInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Category name"
              placeholderTextColor={t.foregroundMuted}
              autoFocus
              maxLength={50}
              returnKeyType="done"
              onSubmitEditing={save}
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnCancel]}
                onPress={() => setModalOpen(false)}
              >
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, saving && styles.btnDisabled]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reassign picker before delete */}
      <Modal
        visible={reassignOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReassignOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Move transactions to…</Text>
            <Text style={styles.sheetSubtitle}>
              All transactions in "{deleteTarget?.name}" will be moved to the category you pick.
            </Text>
            <FlatList
              data={reassignOptions}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 280 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.reassignRow}
                  onPress={() => confirmDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                >
                  {item.icon ? (
                    <Text style={styles.icon}>{item.icon}</Text>
                  ) : (
                    <View style={styles.iconPlaceholder} />
                  )}
                  <Text style={styles.reassignName}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={[styles.btn, styles.btnCancel, { marginTop: spacing.md }]}
              onPress={() => setReassignOpen(false)}
            >
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.backgroundSubtle },
    list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 40 },
    sectionHeader: {
      fontSize: typography.size.xs,
      fontWeight: typography.weight.semibold,
      color: t.foregroundMuted,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    row: {
      backgroundColor: t.background,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: t.border,
    },
    rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
    icon: { fontSize: 20 },
    iconPlaceholder: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: t.primarySubtle,
    },
    iconPlaceholderSystem: { backgroundColor: t.backgroundSubtle },
    name: { fontSize: typography.size.base, color: t.foreground, fontWeight: typography.weight.medium, flex: 1 },
    badge: {
      fontSize: typography.size.xs,
      color: t.foregroundMuted,
      backgroundColor: t.backgroundSubtle,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: t.border,
    },
    rowActions: { flexDirection: "row", gap: spacing.sm },
    actionBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: t.border,
    },
    actionBtnText: { fontSize: typography.size.xs, color: t.foreground, fontWeight: typography.weight.medium },
    actionBtnDelete: { borderColor: t.destructive },
    actionBtnDeleteText: { fontSize: typography.size.xs, color: t.destructive, fontWeight: typography.weight.medium },
    emptyRow: {
      backgroundColor: t.background,
      borderRadius: radius.md,
      padding: spacing.lg,
      alignItems: "center",
      borderWidth: 1,
      borderColor: t.border,
    },
    emptyText: { fontSize: typography.size.sm, color: t.foregroundMuted },
    // Modal
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: t.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
    },
    sheetTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: t.foreground },
    sheetSubtitle: { fontSize: typography.size.sm, color: t.foregroundMuted },
    textInput: {
      height: 48,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: typography.size.base,
      color: t.foreground,
      backgroundColor: t.backgroundSubtle,
    },
    sheetActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
    btn: { flex: 1, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    btnCancel: { borderWidth: 1, borderColor: t.border, backgroundColor: t.backgroundSubtle },
    btnCancelText: { fontSize: typography.size.base, color: t.foreground, fontWeight: typography.weight.medium },
    btnPrimary: { backgroundColor: t.primary },
    btnPrimaryText: { fontSize: typography.size.base, color: "#fff", fontWeight: typography.weight.semibold },
    btnDisabled: { opacity: 0.5 },
    reassignRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
    },
    reassignName: { fontSize: typography.size.base, color: t.foreground, fontWeight: typography.weight.medium },
  });
}
