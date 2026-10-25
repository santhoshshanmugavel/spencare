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
import { useAuth } from "../../../lib/auth";
import { useTheme, spacing, radius, typography } from "../../../lib/theme";
import {
  api,
  type VehicleJSON,
  type FuelEntryJSON,
  type VehicleDashboardJSON,
  type VehicleExpenseJSON,
  type MaintenanceRecordJSON,
  type VehicleDocumentJSON,
  type VehicleReminderJSON,
  type VehicleExpenseCategory,
  type MaintenanceCategory,
  type VehicleDocumentType,
} from "../../../lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatOdo(tenths: number, unit = "km"): string {
  return `${(tenths / 10).toFixed(1)} ${unit}`;
}
function formatFuelL(ml: number): string { return `${(ml / 1000).toFixed(2)} L`; }
function formatMoney(minor: number, currency = "INR"): string {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100); }
  catch { return `${currency} ${(minor / 100).toFixed(0)}`; }
}
function vehicleLabel(v: VehicleJSON): string {
  const parts = [v.make, v.model, v.variant].filter(Boolean);
  return parts.length ? parts.join(" ") : v.name;
}
function todayISO(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

type DetailTab = "fuel" | "expenses" | "maintenance" | "reminders" | "docs";

// ── Small reusable row components ─────────────────────────────────────────────

function FuelRow({ entry, currency }: { entry: FuelEntryJSON; currency: string }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.foreground }]}>{entry.occurred_at.slice(0, 10)}</Text>
        <Text style={[styles.rowSub, { color: t.foregroundMuted }]}>
          {formatFuelL(entry.fuel_quantity_ml)} · {formatOdo(entry.odometer)}{entry.station_name ? ` · ${entry.station_name}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {entry.total_cost_minor != null && (
          <Text style={[styles.rowAmt, { color: t.foreground }]}>{formatMoney(entry.total_cost_minor, entry.currency ?? currency)}</Text>
        )}
        {entry.is_full_tank && <Text style={[{ fontSize: 10, color: t.income }]}>FULL</Text>}
      </View>
    </View>
  );
}

function ExpenseRow({ item }: { item: VehicleExpenseJSON }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.foreground }]}>{item.description ?? item.expense_category}</Text>
        <Text style={[styles.rowSub, { color: t.foregroundMuted }]}>{item.expense_category} · {item.occurred_at.slice(0, 10)}</Text>
      </View>
      <Text style={[styles.rowAmt, { color: t.expense }]}>{formatMoney(item.amount_minor, item.currency)}</Text>
    </View>
  );
}

function MaintenanceRow({ item }: { item: MaintenanceRecordJSON }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.foreground }]}>{item.title}</Text>
        <Text style={[styles.rowSub, { color: t.foregroundMuted }]}>
          {item.maintenance_category}{item.serviced_at ? ` · ${item.serviced_at.slice(0, 10)}` : ""}
          {item.odometer ? ` · ${formatOdo(item.odometer)}` : ""}
        </Text>
      </View>
      {item.cost_minor != null && (
        <Text style={[styles.rowAmt, { color: t.foreground }]}>{formatMoney(item.cost_minor, item.currency)}</Text>
      )}
    </View>
  );
}

function ReminderRow({ item, onDismiss }: { item: VehicleReminderJSON; onDismiss: () => void }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.foreground }]}>{item.title}</Text>
        {item.due_date && <Text style={[styles.rowSub, { color: t.foregroundMuted }]}>Due {item.due_date.slice(0, 10)}</Text>}
      </View>
      <TouchableOpacity onPress={onDismiss} accessibilityLabel="Dismiss reminder">
        <Text style={{ color: t.foregroundMuted, fontSize: 13 }}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

function DocumentRow({ item }: { item: VehicleDocumentJSON }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: t.foreground }]}>{item.title}</Text>
        <Text style={[styles.rowSub, { color: t.foregroundMuted }]}>
          {item.document_type}{item.expiry_date ? ` · Expires ${item.expiry_date.slice(0, 10)}` : ""}
        </Text>
      </View>
    </View>
  );
}

function VehicleCard({ vehicle, onPress }: { vehicle: VehicleJSON; onPress: () => void }) {
  const t = useTheme();
  return (
    <TouchableOpacity style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: t.foreground }]}>{vehicle.name}</Text>
          {(vehicle.make || vehicle.model) && (
            <Text style={[styles.rowSub, { color: t.foregroundMuted }]}>{vehicleLabel(vehicle)}</Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.cardTitle, { color: t.primary }]}>{formatOdo(vehicle.current_odometer, vehicle.odometer_unit)}</Text>
          <Text style={[styles.rowSub, { color: t.foregroundMuted }]}>{vehicle.vehicle_type}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function VehiclesScreen(): React.JSX.Element {
  const { session } = useAuth();
  const t = useTheme();
  const accessToken = session?.accessToken ?? "";

  const [vehicles, setVehicles] = useState<VehicleJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Detail state
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleJSON | null>(null);
  const [dashboard, setDashboard] = useState<VehicleDashboardJSON | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("fuel");

  // Tab data
  const [fuelEntries, setFuelEntries] = useState<FuelEntryJSON[]>([]);
  const [expenses, setExpenses] = useState<VehicleExpenseJSON[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecordJSON[]>([]);
  const [reminders, setReminders] = useState<VehicleReminderJSON[]>([]);
  const [documents, setDocuments] = useState<VehicleDocumentJSON[]>([]);

  // Create vehicle modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("car");
  const [newFuelType, setNewFuelType] = useState("petrol");
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newOdo, setNewOdo] = useState("");
  const [createSaving, setCreateSaving] = useState(false);

  // Add fuel modal
  const [showAddFuel, setShowAddFuel] = useState(false);
  const [fuelDate, setFuelDate] = useState(todayISO());
  const [fuelOdo, setFuelOdo] = useState("");
  const [fuelQtyL, setFuelQtyL] = useState("");
  const [fuelCostTotal, setFuelCostTotal] = useState("");
  const [fuelIsFullTank, setFuelIsFullTank] = useState(true);
  const [fuelSaving, setFuelSaving] = useState(false);

  // Add expense modal
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expDate, setExpDate] = useState(todayISO());
  const [expAmt, setExpAmt] = useState("");
  const [expCat, setExpCat] = useState<VehicleExpenseCategory>("other");
  const [expDesc, setExpDesc] = useState("");
  const [expSaving, setExpSaving] = useState(false);

  // Add maintenance modal
  const [showAddMaint, setShowAddMaint] = useState(false);
  const [maintTitle, setMaintTitle] = useState("");
  const [maintCat, setMaintCat] = useState<MaintenanceCategory>("service");
  const [maintDate, setMaintDate] = useState(todayISO());
  const [maintCost, setMaintCost] = useState("");
  const [maintNextDate, setMaintNextDate] = useState("");
  const [maintSaving, setMaintSaving] = useState(false);

  // Add document modal
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [docType, setDocType] = useState<VehicleDocumentType>("insurance");
  const [docTitle, setDocTitle] = useState("");
  const [docExpiry, setDocExpiry] = useState("");
  const [docSaving, setDocSaving] = useState(false);

  const loadVehicles = useCallback(async () => {
    try {
      const result = await api.listVehicles(accessToken);
      setVehicles(result.vehicles.filter((v) => v.status === "active"));
    } catch { /* silently ignore */ }
  }, [accessToken]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadVehicles().finally(() => setLoading(false));
  }, [loadVehicles]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadVehicles();
    setRefreshing(false);
  }, [loadVehicles]);

  const loadTabData = useCallback(async (vehicleId: string, tab: DetailTab) => {
    try {
      if (tab === "fuel") {
        const r = await api.listFuelEntries(vehicleId, accessToken, 50);
        setFuelEntries(r.fuel_entries);
      } else if (tab === "expenses") {
        const r = await api.listExpenses(vehicleId, accessToken);
        setExpenses(r.expenses);
      } else if (tab === "maintenance") {
        const r = await api.listMaintenance(vehicleId, accessToken);
        setMaintenance(r.maintenance_records);
      } else if (tab === "reminders") {
        const r = await api.listReminders(vehicleId, accessToken);
        setReminders(r.reminders);
      } else if (tab === "docs") {
        const r = await api.listDocuments(vehicleId, accessToken);
        setDocuments(r.documents);
      }
    } catch { /* ignore */ }
  }, [accessToken]);

  const openVehicle = useCallback(async (v: VehicleJSON) => {
    setSelectedVehicle(v);
    setActiveTab("fuel");
    setDetailLoading(true);
    try {
      const [dashRes] = await Promise.all([
        api.getVehicle(v.id, accessToken),
        loadTabData(v.id, "fuel"),
      ]);
      setDashboard(dashRes);
    } catch { /* ignore */ }
    setDetailLoading(false);
  }, [accessToken, loadTabData]);

  const handleTabChange = useCallback((tab: DetailTab) => {
    if (!selectedVehicle) return;
    setActiveTab(tab);
    loadTabData(selectedVehicle.id, tab);
  }, [selectedVehicle, loadTabData]);

  const closeDetail = () => {
    setSelectedVehicle(null); setDashboard(null);
    setFuelEntries([]); setExpenses([]); setMaintenance([]); setReminders([]); setDocuments([]);
  };

  const handleCreateVehicle = async () => {
    if (!newName.trim()) return;
    setCreateSaving(true);
    try {
      await api.createVehicle({
        name: newName.trim(), vehicle_type: newType, fuel_type: newFuelType,
        make: newMake.trim() || undefined, model: newModel.trim() || undefined,
        current_odometer: newOdo ? Math.round(parseFloat(newOdo) * 10) : 0,
      }, accessToken);
      setShowCreate(false);
      setNewName(""); setNewType("car"); setNewFuelType("petrol"); setNewMake(""); setNewModel(""); setNewOdo("");
      await loadVehicles();
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not create vehicle."); }
    setCreateSaving(false);
  };

  const handleAddFuel = async () => {
    if (!selectedVehicle || !fuelOdo || !fuelQtyL) return;
    const odoTenths = Math.round(parseFloat(fuelOdo) * 10);
    const qtyMl = Math.round(parseFloat(fuelQtyL) * 1000);
    if (odoTenths <= 0 || qtyMl <= 0) { Alert.alert("Error", "Enter a valid odometer and quantity."); return; }
    setFuelSaving(true);
    try {
      await api.addFuelEntry(selectedVehicle.id, {
        occurred_at: fuelDate, odometer: odoTenths, fuel_quantity_ml: qtyMl,
        total_cost_minor: fuelCostTotal ? Math.round(parseFloat(fuelCostTotal) * 100) : undefined,
        is_full_tank: fuelIsFullTank,
      }, accessToken);
      setShowAddFuel(false);
      setFuelOdo(""); setFuelQtyL(""); setFuelCostTotal(""); setFuelIsFullTank(true); setFuelDate(todayISO());
      await loadTabData(selectedVehicle.id, "fuel");
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not log fuel entry."); }
    setFuelSaving(false);
  };

  const handleAddExpense = async () => {
    if (!selectedVehicle || !expAmt) return;
    const amtMinor = Math.round(parseFloat(expAmt) * 100);
    if (amtMinor <= 0) { Alert.alert("Error", "Enter a valid amount."); return; }
    setExpSaving(true);
    try {
      await api.addExpense(selectedVehicle.id, {
        occurred_at: expDate, amount_minor: amtMinor, expense_category: expCat,
        description: expDesc.trim() || undefined,
      }, accessToken);
      setShowAddExpense(false);
      setExpDate(todayISO()); setExpAmt(""); setExpCat("other"); setExpDesc("");
      await loadTabData(selectedVehicle.id, "expenses");
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not add expense."); }
    setExpSaving(false);
  };

  const handleAddMaintenance = async () => {
    if (!selectedVehicle || !maintTitle.trim()) return;
    setMaintSaving(true);
    try {
      await api.addMaintenance(selectedVehicle.id, {
        title: maintTitle.trim(), maintenance_category: maintCat,
        serviced_at: maintDate || undefined,
        cost_minor: maintCost ? Math.round(parseFloat(maintCost) * 100) : undefined,
        next_due_date: maintNextDate.trim() || undefined,
        status: "completed",
      }, accessToken);
      setShowAddMaint(false);
      setMaintTitle(""); setMaintCat("service"); setMaintDate(todayISO()); setMaintCost(""); setMaintNextDate("");
      await loadTabData(selectedVehicle.id, "maintenance");
      if (maintNextDate.trim()) await loadTabData(selectedVehicle.id, "reminders");
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not add maintenance record."); }
    setMaintSaving(false);
  };

  const handleAddDocument = async () => {
    if (!selectedVehicle || !docTitle.trim()) return;
    setDocSaving(true);
    try {
      await api.addDocument(selectedVehicle.id, {
        document_type: docType, title: docTitle.trim(),
        expiry_date: docExpiry.trim() || undefined,
        reminder_days_before: docExpiry ? [30, 7] : undefined,
      }, accessToken);
      setShowAddDoc(false);
      setDocType("insurance"); setDocTitle(""); setDocExpiry("");
      await loadTabData(selectedVehicle.id, "docs");
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not add document."); }
    setDocSaving(false);
  };

  const handleDismissReminder = async (reminderId: string) => {
    if (!selectedVehicle) return;
    try {
      await api.dismissReminder(selectedVehicle.id, reminderId, accessToken);
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    } catch { Alert.alert("Error", "Could not dismiss reminder."); }
  };

  const getAddAction = (): (() => void) | null => {
    if (activeTab === "fuel") return () => setShowAddFuel(true);
    if (activeTab === "expenses") return () => setShowAddExpense(true);
    if (activeTab === "maintenance") return () => setShowAddMaint(true);
    if (activeTab === "docs") return () => setShowAddDoc(true);
    return null;
  };

  const addAction = selectedVehicle ? getAddAction() : null;

  if (loading) return (
    <View style={[styles.center, { backgroundColor: t.background }]}>
      <ActivityIndicator color={t.primary} />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.foreground }]}>Vehicles</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)} style={[styles.addBtn, { backgroundColor: t.primary }]}>
          <Text style={{ color: t.primaryForeground, fontWeight: "600", fontSize: 16 }}>+</Text>
        </TouchableOpacity>
      </View>

      {vehicles.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.empty, { color: t.foregroundMuted }]}>No vehicles yet. Tap + to add one.</Text>
        </View>
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: spacing.lg }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          renderItem={({ item }) => <VehicleCard vehicle={item} onPress={() => openVehicle(item)} />}
        />
      )}

      {/* ── Vehicle detail modal ── */}
      <Modal visible={!!selectedVehicle} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeDetail}>
        <View style={[styles.modal, { backgroundColor: t.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={closeDetail}>
              <Text style={{ color: t.primary, fontSize: 16 }}>← Back</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>{selectedVehicle?.name ?? ""}</Text>
            {addAction ? (
              <TouchableOpacity onPress={addAction}>
                <Text style={{ color: t.primary, fontSize: 14, fontWeight: "600" }}>+ Add</Text>
              </TouchableOpacity>
            ) : <View style={{ width: 48 }} />}
          </View>

          {/* Stats row */}
          {dashboard && (
            <View style={[styles.statsRow, { backgroundColor: t.card, borderBottomColor: t.border }]}>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: t.foregroundMuted }]}>Odometer</Text>
                <Text style={[styles.statValue, { color: t.foreground }]}>{formatOdo(selectedVehicle?.current_odometer ?? 0, selectedVehicle?.odometer_unit)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: t.foregroundMuted }]}>Efficiency</Text>
                <Text style={[styles.statValue, { color: t.foreground }]}>
                  {dashboard.efficiency.type === "computed" && dashboard.efficiency.kmPerLitreCx100
                    ? `${(dashboard.efficiency.kmPerLitreCx100 / 100).toFixed(1)} km/L` : "—"}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statLabel, { color: t.foregroundMuted }]}>Total cost</Text>
                <Text style={[styles.statValue, { color: t.foreground }]}>{formatMoney(dashboard.total_cost_minor, dashboard.currency)}</Text>
              </View>
            </View>
          )}

          {/* Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabBar, { borderBottomColor: t.border }]} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
            {(["fuel", "expenses", "maintenance", "reminders", "docs"] as DetailTab[]).map((tab) => (
              <TouchableOpacity key={tab} onPress={() => handleTabChange(tab)} style={[styles.tab, { borderBottomColor: activeTab === tab ? t.primary : "transparent" }]}>
                <Text style={[styles.tabText, { color: activeTab === tab ? t.primary : t.foregroundMuted }]}>
                  {tab === "fuel" ? "Fuel" : tab === "expenses" ? "Expenses" : tab === "maintenance" ? "Service" : tab === "reminders" ? "Reminders" : "Docs"}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {detailLoading ? (
            <View style={styles.center}><ActivityIndicator color={t.primary} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
              {activeTab === "fuel" && (
                fuelEntries.length === 0
                  ? <Text style={[styles.empty, { color: t.foregroundMuted, margin: spacing.lg }]}>No fuel entries yet.</Text>
                  : fuelEntries.map((e) => <FuelRow key={e.id} entry={e} currency={dashboard?.currency ?? "INR"} />)
              )}
              {activeTab === "expenses" && (
                expenses.length === 0
                  ? <Text style={[styles.empty, { color: t.foregroundMuted, margin: spacing.lg }]}>No expenses yet.</Text>
                  : expenses.map((e) => <ExpenseRow key={e.id} item={e} />)
              )}
              {activeTab === "maintenance" && (
                maintenance.length === 0
                  ? <Text style={[styles.empty, { color: t.foregroundMuted, margin: spacing.lg }]}>No service records yet.</Text>
                  : maintenance.map((r) => <MaintenanceRow key={r.id} item={r} />)
              )}
              {activeTab === "reminders" && (
                reminders.length === 0
                  ? <Text style={[styles.empty, { color: t.foregroundMuted, margin: spacing.lg }]}>No active reminders.</Text>
                  : reminders.map((r) => <ReminderRow key={r.id} item={r} onDismiss={() => handleDismissReminder(r.id)} />)
              )}
              {activeTab === "docs" && (
                documents.length === 0
                  ? <Text style={[styles.empty, { color: t.foregroundMuted, margin: spacing.lg }]}>No documents yet.</Text>
                  : documents.map((d) => <DocumentRow key={d.id} item={d} />)
              )}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Create vehicle modal ── */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={[styles.modal, { backgroundColor: t.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Text style={{ color: t.foregroundMuted, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Add Vehicle</Text>
            <TouchableOpacity onPress={handleCreateVehicle} disabled={createSaving || !newName.trim()}>
              <Text style={{ color: !newName.trim() ? t.foregroundSubtle : t.primary, fontSize: 16, fontWeight: "600" }}>
                {createSaving ? "Saving…" : "Save"}
              </Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Vehicle Name *</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={newName} onChangeText={setNewName} placeholder="e.g. My Bike" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Make</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={newMake} onChangeText={setNewMake} placeholder="e.g. Honda" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Model</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={newModel} onChangeText={setNewModel} placeholder="e.g. Activa 6G" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Current Odometer (km)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={newOdo} onChangeText={setNewOdo} placeholder="e.g. 12345.6" keyboardType="decimal-pad" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Type</Text>
            <View style={styles.pillRow}>
              {["car", "motorcycle", "scooter", "ev", "other"].map((tp) => (
                <Pressable key={tp} onPress={() => setNewType(tp)} style={[styles.pill, { borderColor: newType === tp ? t.primary : t.border, backgroundColor: newType === tp ? `${t.primary}22` : t.card }]}>
                  <Text style={{ color: newType === tp ? t.primary : t.foregroundMuted, fontSize: 13 }}>{tp}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Fuel Type</Text>
            <View style={styles.pillRow}>
              {["petrol", "diesel", "electric", "cng", "other"].map((ft) => (
                <Pressable key={ft} onPress={() => setNewFuelType(ft)} style={[styles.pill, { borderColor: newFuelType === ft ? t.primary : t.border, backgroundColor: newFuelType === ft ? `${t.primary}22` : t.card }]}>
                  <Text style={{ color: newFuelType === ft ? t.primary : t.foregroundMuted, fontSize: 13 }}>{ft}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add fuel entry modal ── */}
      <Modal visible={showAddFuel} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddFuel(false)}>
        <KeyboardAvoidingView style={[styles.modal, { backgroundColor: t.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setShowAddFuel(false)}><Text style={{ color: t.foregroundMuted, fontSize: 16 }}>Cancel</Text></TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Log Fill-up</Text>
            <TouchableOpacity onPress={handleAddFuel} disabled={fuelSaving || !fuelOdo || !fuelQtyL}>
              <Text style={{ color: !fuelOdo || !fuelQtyL ? t.foregroundSubtle : t.primary, fontSize: 16, fontWeight: "600" }}>{fuelSaving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Date</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={fuelDate} onChangeText={setFuelDate} placeholder="YYYY-MM-DD" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Odometer (km)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={fuelOdo} onChangeText={setFuelOdo} placeholder="e.g. 12500.0" keyboardType="decimal-pad" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Fuel quantity (litres)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={fuelQtyL} onChangeText={setFuelQtyL} placeholder="e.g. 8.50" keyboardType="decimal-pad" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Total cost (₹)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={fuelCostTotal} onChangeText={setFuelCostTotal} placeholder="e.g. 850.00" keyboardType="decimal-pad" placeholderTextColor={t.foregroundSubtle} />
            <Pressable onPress={() => setFuelIsFullTank((p) => !p)} style={[styles.toggleRow, { backgroundColor: t.card, borderColor: t.border }]}>
              <Text style={{ color: t.foreground }}>Full tank</Text>
              <View style={[styles.toggle, { backgroundColor: fuelIsFullTank ? t.primary : t.border }]}>
                <View style={[styles.toggleThumb, { transform: [{ translateX: fuelIsFullTank ? 20 : 0 }] }]} />
              </View>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add expense modal ── */}
      <Modal visible={showAddExpense} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddExpense(false)}>
        <KeyboardAvoidingView style={[styles.modal, { backgroundColor: t.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setShowAddExpense(false)}><Text style={{ color: t.foregroundMuted, fontSize: 16 }}>Cancel</Text></TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Add Expense</Text>
            <TouchableOpacity onPress={handleAddExpense} disabled={expSaving || !expAmt}>
              <Text style={{ color: !expAmt ? t.foregroundSubtle : t.primary, fontSize: 16, fontWeight: "600" }}>{expSaving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Date</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={expDate} onChangeText={setExpDate} placeholder="YYYY-MM-DD" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Amount (₹)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={expAmt} onChangeText={setExpAmt} placeholder="e.g. 500.00" keyboardType="decimal-pad" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Description</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={expDesc} onChangeText={setExpDesc} placeholder="Optional" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Category</Text>
            <View style={styles.pillRow}>
              {(["repair", "accessories", "tyres", "cleaning", "parking", "toll", "other"] as VehicleExpenseCategory[]).map((cat) => (
                <Pressable key={cat} onPress={() => setExpCat(cat)} style={[styles.pill, { borderColor: expCat === cat ? t.primary : t.border, backgroundColor: expCat === cat ? `${t.primary}22` : t.card }]}>
                  <Text style={{ color: expCat === cat ? t.primary : t.foregroundMuted, fontSize: 13 }}>{cat}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add maintenance modal ── */}
      <Modal visible={showAddMaint} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddMaint(false)}>
        <KeyboardAvoidingView style={[styles.modal, { backgroundColor: t.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setShowAddMaint(false)}><Text style={{ color: t.foregroundMuted, fontSize: 16 }}>Cancel</Text></TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Log Service</Text>
            <TouchableOpacity onPress={handleAddMaintenance} disabled={maintSaving || !maintTitle.trim()}>
              <Text style={{ color: !maintTitle.trim() ? t.foregroundSubtle : t.primary, fontSize: 16, fontWeight: "600" }}>{maintSaving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Title *</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={maintTitle} onChangeText={setMaintTitle} placeholder="e.g. Oil change" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Service Date</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={maintDate} onChangeText={setMaintDate} placeholder="YYYY-MM-DD" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Cost (₹)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={maintCost} onChangeText={setMaintCost} placeholder="Optional" keyboardType="decimal-pad" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Next due date (optional — creates reminder)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={maintNextDate} onChangeText={setMaintNextDate} placeholder="YYYY-MM-DD" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Category</Text>
            <View style={styles.pillRow}>
              {(["service", "oil_change", "tyre_rotation", "tyre_replacement", "brake_service", "battery", "chain", "filter", "other"] as MaintenanceCategory[]).map((cat) => (
                <Pressable key={cat} onPress={() => setMaintCat(cat)} style={[styles.pill, { borderColor: maintCat === cat ? t.primary : t.border, backgroundColor: maintCat === cat ? `${t.primary}22` : t.card }]}>
                  <Text style={{ color: maintCat === cat ? t.primary : t.foregroundMuted, fontSize: 12 }}>{cat.replace("_", " ")}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add document modal ── */}
      <Modal visible={showAddDoc} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAddDoc(false)}>
        <KeyboardAvoidingView style={[styles.modal, { backgroundColor: t.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setShowAddDoc(false)}><Text style={{ color: t.foregroundMuted, fontSize: 16 }}>Cancel</Text></TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Add Document</Text>
            <TouchableOpacity onPress={handleAddDocument} disabled={docSaving || !docTitle.trim()}>
              <Text style={{ color: !docTitle.trim() ? t.foregroundSubtle : t.primary, fontSize: 16, fontWeight: "600" }}>{docSaving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Title *</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={docTitle} onChangeText={setDocTitle} placeholder="e.g. HDFC Motor Insurance" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Expiry Date (optional)</Text>
            <TextInput style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.foreground }]} value={docExpiry} onChangeText={setDocExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={t.foregroundSubtle} />
            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Document Type</Text>
            <View style={styles.pillRow}>
              {(["insurance", "puc", "rc", "road_tax", "permit", "warranty", "other"] as VehicleDocumentType[]).map((dt) => (
                <Pressable key={dt} onPress={() => setDocType(dt)} style={[styles.pill, { borderColor: docType === dt ? t.primary : t.border, backgroundColor: docType === dt ? `${t.primary}22` : t.card }]}>
                  <Text style={{ color: docType === dt ? t.primary : t.foregroundMuted, fontSize: 13 }}>{dt}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  addBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center" },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  cardRow: { flexDirection: "row", alignItems: "center" },
  cardTitle: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  empty: { textAlign: "center", fontSize: typography.size.sm },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: typography.size.sm, fontWeight: typography.weight.medium },
  rowSub: { fontSize: typography.size.xs, marginTop: 2 },
  rowAmt: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  statsRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm },
  statItem: { flex: 1, alignItems: "center" },
  statLabel: { fontSize: typography.size.xs, marginBottom: 2 },
  statValue: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  tabBar: { borderBottomWidth: StyleSheet.hairlineWidth, flexGrow: 0 },
  tab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 2 },
  tabText: { fontSize: typography.size.sm, fontWeight: typography.weight.medium },
  modal: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  fieldLabel: { fontSize: typography.size.sm, marginBottom: 4, marginTop: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: typography.size.md },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  pill: { borderWidth: 1, borderRadius: radius.xl, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, marginTop: spacing.lg },
  toggle: { width: 44, height: 24, borderRadius: 12, justifyContent: "center", paddingHorizontal: 2 },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "white" },
});
