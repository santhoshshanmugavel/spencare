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
} from "../../../lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatOdo(tenths: number, unit = "km"): string {
  return `${(tenths / 10).toFixed(1)} ${unit}`;
}

function formatFuelL(ml: number): string {
  return `${(ml / 1000).toFixed(2)} L`;
}

function formatMoney(minor: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(0)}`;
  }
}

function vehicleLabel(v: VehicleJSON): string {
  const parts = [v.make, v.model, v.variant].filter(Boolean);
  return parts.length ? parts.join(" ") : v.name;
}

function todayISO(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

// ── VehicleCard ───────────────────────────────────────────────────────────────

function VehicleCard({
  vehicle,
  onPress,
}: {
  vehicle: VehicleJSON;
  onPress: () => void;
}): React.JSX.Element {
  const t = useTheme();
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: t.foreground }]}>{vehicle.name}</Text>
          {(vehicle.make || vehicle.model) ? (
            <Text style={[styles.cardSub, { color: t.foregroundMuted }]}>{vehicleLabel(vehicle)}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.odoText, { color: t.primary }]}>{formatOdo(vehicle.current_odometer, vehicle.odometer_unit)}</Text>
          <Text style={[styles.cardSub, { color: t.foregroundMuted }]}>{vehicle.vehicle_type}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── FuelEntryRow ──────────────────────────────────────────────────────────────

function FuelEntryRow({ entry, currency }: { entry: FuelEntryJSON; currency: string }): React.JSX.Element {
  const t = useTheme();
  return (
    <View style={[styles.fuelRow, { borderBottomColor: t.separator }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.fuelDate, { color: t.foreground }]}>{entry.occurred_at.slice(0, 10)}</Text>
        <Text style={[styles.cardSub, { color: t.foregroundMuted }]}>
          {formatFuelL(entry.fuel_quantity_ml)} · {formatOdo(entry.odometer)}
          {entry.station_name ? ` · ${entry.station_name}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {entry.total_cost_minor != null ? (
          <Text style={[styles.fuelCost, { color: t.foreground }]}>{formatMoney(entry.total_cost_minor, entry.currency ?? currency)}</Text>
        ) : null}
        {entry.is_full_tank ? (
          <Text style={[{ fontSize: 10, color: t.income }]}>FULL</Text>
        ) : null}
      </View>
    </View>
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

  // Detail/fuel modal state
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleJSON | null>(null);
  const [dashboard, setDashboard] = useState<VehicleDashboardJSON | null>(null);
  const [fuelEntries, setFuelEntries] = useState<FuelEntryJSON[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create vehicle modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("car");
  const [newFuelType, setNewFuelType] = useState("petrol");
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newOdo, setNewOdo] = useState("");
  const [createSaving, setCreateSaving] = useState(false);

  // Add fuel entry modal
  const [showAddFuel, setShowAddFuel] = useState(false);
  const [fuelDate, setFuelDate] = useState(todayISO());
  const [fuelOdo, setFuelOdo] = useState("");
  const [fuelQtyL, setFuelQtyL] = useState("");
  const [fuelCostTotal, setFuelCostTotal] = useState("");
  const [fuelIsFullTank, setFuelIsFullTank] = useState(true);
  const [fuelSaving, setFuelSaving] = useState(false);

  const loadVehicles = useCallback(async () => {
    try {
      const result = await api.listVehicles(accessToken);
      setVehicles(result.vehicles.filter((v) => v.status === "active"));
    } catch { /* silently ignore refresh errors */ }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadVehicles().finally(() => setLoading(false));
    }, [loadVehicles]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadVehicles();
    setRefreshing(false);
  }, [loadVehicles]);

  const openVehicle = useCallback(async (v: VehicleJSON) => {
    setSelectedVehicle(v);
    setDetailLoading(true);
    try {
      const [dashRes, fuelRes] = await Promise.all([
        api.getVehicle(v.id, accessToken),
        api.listFuelEntries(v.id, accessToken, 30),
      ]);
      setDashboard(dashRes);
      setFuelEntries(fuelRes.fuel_entries);
    } catch { /* ignore */ }
    setDetailLoading(false);
  }, [accessToken]);

  const closeDetail = () => { setSelectedVehicle(null); setDashboard(null); setFuelEntries([]); };

  const handleCreateVehicle = async () => {
    if (!newName.trim()) return;
    setCreateSaving(true);
    const odoTenths = newOdo ? Math.round(parseFloat(newOdo) * 10) : 0;
    try {
      await api.createVehicle({
        name: newName.trim(),
        vehicle_type: newType,
        fuel_type: newFuelType,
        make: newMake.trim() || undefined,
        model: newModel.trim() || undefined,
        current_odometer: odoTenths,
      }, accessToken);
      setShowCreate(false);
      setNewName(""); setNewType("car"); setNewFuelType("petrol"); setNewMake(""); setNewModel(""); setNewOdo("");
      await loadVehicles();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not create vehicle.");
    }
    setCreateSaving(false);
  };

  const handleAddFuel = async () => {
    if (!selectedVehicle || !fuelOdo || !fuelQtyL) return;
    const odoTenths = Math.round(parseFloat(fuelOdo) * 10);
    const qtyMl = Math.round(parseFloat(fuelQtyL) * 1000);
    const costMinor = fuelCostTotal ? Math.round(parseFloat(fuelCostTotal) * 100) : null;
    if (odoTenths <= 0 || qtyMl <= 0) {
      Alert.alert("Error", "Enter a valid odometer reading and fuel quantity.");
      return;
    }
    setFuelSaving(true);
    try {
      await api.addFuelEntry(selectedVehicle.id, {
        occurred_at: fuelDate,
        odometer: odoTenths,
        fuel_quantity_ml: qtyMl,
        total_cost_minor: costMinor ?? undefined,
        is_full_tank: fuelIsFullTank,
      }, accessToken);
      setShowAddFuel(false);
      setFuelOdo(""); setFuelQtyL(""); setFuelCostTotal(""); setFuelIsFullTank(true); setFuelDate(todayISO());
      await openVehicle(selectedVehicle);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not log fuel entry.");
    }
    setFuelSaving(false);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: t.background }]}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.background }]}>
      {/* Header */}
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
            <TouchableOpacity onPress={() => setShowAddFuel(true)}>
              <Text style={{ color: t.primary, fontSize: 14, fontWeight: "600" }}>+ Fuel</Text>
            </TouchableOpacity>
          </View>

          {detailLoading ? (
            <View style={styles.center}><ActivityIndicator color={t.primary} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              {/* Stats */}
              {dashboard && (
                <View style={[styles.statsRow, { backgroundColor: t.card, borderColor: t.border }]}>
                  <View style={styles.statItem}>
                    <Text style={[styles.statLabel, { color: t.foregroundMuted }]}>Odometer</Text>
                    <Text style={[styles.statValue, { color: t.foreground }]}>{formatOdo(selectedVehicle?.current_odometer ?? 0, selectedVehicle?.odometer_unit)}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={[styles.statLabel, { color: t.foregroundMuted }]}>Efficiency</Text>
                    <Text style={[styles.statValue, { color: t.foreground }]}>
                      {dashboard.efficiency.type === "computed" && dashboard.efficiency.kmPerLitreCx100
                        ? `${(dashboard.efficiency.kmPerLitreCx100 / 100).toFixed(1)} km/L`
                        : "—"}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={[styles.statLabel, { color: t.foregroundMuted }]}>Total cost</Text>
                    <Text style={[styles.statValue, { color: t.foreground }]}>{formatMoney(dashboard.total_cost_minor, dashboard.currency)}</Text>
                  </View>
                </View>
              )}

              <Text style={[styles.sectionTitle, { color: t.foregroundMuted }]}>Recent Fill-ups</Text>
              {fuelEntries.length === 0 ? (
                <Text style={[styles.empty, { color: t.foregroundMuted }]}>No fuel entries yet.</Text>
              ) : (
                fuelEntries.map((e) => (
                  <FuelEntryRow key={e.id} entry={e} currency={dashboard?.currency ?? "INR"} />
                ))
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
                <Pressable key={tp} onPress={() => setNewType(tp)}
                  style={[styles.pill, { borderColor: newType === tp ? t.primary : t.border, backgroundColor: newType === tp ? `${t.primary}22` : t.card }]}>
                  <Text style={{ color: newType === tp ? t.primary : t.foregroundMuted, fontSize: 13 }}>{tp}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: t.foregroundMuted }]}>Fuel Type</Text>
            <View style={styles.pillRow}>
              {["petrol", "diesel", "electric", "cng", "other"].map((ft) => (
                <Pressable key={ft} onPress={() => setNewFuelType(ft)}
                  style={[styles.pill, { borderColor: newFuelType === ft ? t.primary : t.border, backgroundColor: newFuelType === ft ? `${t.primary}22` : t.card }]}>
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
            <TouchableOpacity onPress={() => setShowAddFuel(false)}>
              <Text style={{ color: t.foregroundMuted, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.foreground }]}>Log Fill-up</Text>
            <TouchableOpacity onPress={handleAddFuel} disabled={fuelSaving || !fuelOdo || !fuelQtyL}>
              <Text style={{ color: !fuelOdo || !fuelQtyL ? t.foregroundSubtle : t.primary, fontSize: 16, fontWeight: "600" }}>
                {fuelSaving ? "Saving…" : "Save"}
              </Text>
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

            <Pressable onPress={() => setFuelIsFullTank((p) => !p)}
              style={[styles.toggleRow, { backgroundColor: t.card, borderColor: t.border }]}>
              <Text style={{ color: t.foreground }}>Full tank</Text>
              <View style={[styles.toggle, { backgroundColor: fuelIsFullTank ? t.primary : t.border }]}>
                <View style={[styles.toggleThumb, { transform: [{ translateX: fuelIsFullTank ? 20 : 0 }] }]} />
              </View>
            </Pressable>
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
  cardSub: { fontSize: typography.size.sm, marginTop: 2 },
  odoText: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  empty: { textAlign: "center", fontSize: typography.size.sm },
  fuelRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  fuelDate: { fontSize: typography.size.sm, fontWeight: typography.weight.medium },
  fuelCost: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
  statsRow: { flexDirection: "row", borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, marginBottom: spacing.lg },
  statItem: { flex: 1, alignItems: "center" },
  statLabel: { fontSize: typography.size.xs, marginBottom: 2 },
  statValue: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  sectionTitle: { fontSize: typography.size.xs, fontWeight: typography.weight.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm },
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
