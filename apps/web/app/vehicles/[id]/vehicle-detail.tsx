"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Fuel, Wrench, FileText, Bell, DollarSign, BarChart3,
  Plus, Trash2, Gauge, Activity, TrendingUp, Car, Bike,
} from "lucide-react";
import type {
  VehicleMaintenanceRow,
  VehicleDocumentRow,
  VehicleReminderRow,
} from "@spencare/domain-application";
import type { VehicleDashboardData } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { formatMinorUnits } from "@/lib/currency-format";
import {
  createFuelEntryAction,
  deleteFuelEntryAction,
  createVehicleExpenseAction,
  deleteVehicleExpenseAction,
  createMaintenanceRecordAction,
  deleteMaintenanceRecordAction,
  createVehicleDocumentAction,
  deleteVehicleDocumentAction,
  dismissVehicleReminderAction,
} from "../actions";

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtAmount(amountMinor: bigint | number, currency: string, masked: boolean): string {
  if (masked) return `${currency === "INR" ? "₹" : currency}***`;
  const minor = typeof amountMinor === "bigint" ? Number(amountMinor) : amountMinor;
  const f = formatMinorUnits(BigInt(Math.round(minor)), currency);
  return `${f.symbol}${f.integerPart}${f.decimalPart ? "." + f.decimalPart : ""}`;
}

function fmtOdometer(tenths: number): string {
  return (tenths / 10).toFixed(1) + " km";
}

function fmtLitres(ml: number): string {
  return (ml / 1000).toFixed(2) + " L";
}

function fmtDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function daysUntil(dateStr: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(dateStr) - Date.parse(today)) / 86_400_000);
}

function groupByMonth<T extends { occurred_at: string }>(
  entries: T[]
): { month: string; label: string; entries: T[] }[] {
  const map = new Map<string, T[]>();
  for (const e of entries) {
    const key = e.occurred_at.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).map(([month, items]) => ({
    month,
    label: formatMonthLabel(month),
    entries: items,
  }));
}

// ── Tab config ─────────────────────────────────────────────────────────────

type TabId = "fuel" | "expenses" | "maintenance" | "documents" | "reminders" | "analytics";

const TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
  { id: "fuel", label: "Fuel Log", Icon: Fuel },
  { id: "expenses", label: "Expenses", Icon: DollarSign },
  { id: "maintenance", label: "Service", Icon: Wrench },
  { id: "documents", label: "Docs", Icon: FileText },
  { id: "reminders", label: "Alerts", Icon: Bell },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
];

// ── Props ──────────────────────────────────────────────────────────────────

interface VehicleDetailProps {
  dashboard: VehicleDashboardData;
  maintenanceRecords: VehicleMaintenanceRow[];
  documents: VehicleDocumentRow[];
  reminders: VehicleReminderRow[];
  masked: boolean;
}

// ── Main component ─────────────────────────────────────────────────────────

export function VehicleDetail({
  dashboard,
  maintenanceRecords: initialMaintenance,
  documents: initialDocuments,
  reminders: initialReminders,
  masked,
}: VehicleDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<TabId>("fuel");

  const [fuelEntries, setFuelEntries] = useState(dashboard.fuelEntries);
  const [expenses, setExpenses] = useState(dashboard.expenses);
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [documents, setDocuments] = useState(initialDocuments);
  const [reminders, setReminders] = useState(initialReminders);

  const vehicleId = dashboard.vehicle.id;
  const currency = dashboard.currency;
  const efficiency = dashboard.efficiency;
  const costPerKm = dashboard.costPerKm;

  const fuelByMonth = useMemo(() => groupByMonth(fuelEntries), [fuelEntries]);
  const expensesByMonth = useMemo(() => groupByMonth(expenses), [expenses]);

  const chartData = useMemo(
    () => [...dashboard.monthlyCosts].reverse().slice(-7),
    [dashboard.monthlyCosts]
  );
  const maxBar = useMemo(
    () => Math.max(...chartData.map((m) => m.totalCostMinor), 1),
    [chartData]
  );

  // ── Fuel dialog ──────────────────────────────────────────────────────────

  const [showFuelDialog, setShowFuelDialog] = useState(false);
  const [fuelDate, setFuelDate] = useState(new Date().toISOString().slice(0, 10));
  const [fuelOdometer, setFuelOdometer] = useState("");
  const [fuelLitres, setFuelLitresState] = useState("");
  const [fuelCost, setFuelCost] = useState("");
  const [fuelIsFull, setFuelIsFull] = useState(true);
  const [fuelError, setFuelError] = useState<string | null>(null);

  function handleAddFuel() {
    const odoTenths = Math.round(parseFloat(fuelOdometer) * 10);
    const fuelMl = Math.round(parseFloat(fuelLitres) * 1000);
    const costMinor = fuelCost ? Math.round(parseFloat(fuelCost) * 100) : null;
    if (isNaN(odoTenths) || odoTenths < 0) { setFuelError("Enter a valid odometer reading."); return; }
    if (isNaN(fuelMl) || fuelMl <= 0) { setFuelError("Enter a valid fuel quantity."); return; }
    setFuelError(null);
    startTransition(async () => {
      const result = await createFuelEntryAction({
        vehicleId,
        occurredAt: fuelDate,
        odometer: odoTenths,
        fuelQuantityMl: fuelMl,
        totalCostMinor: costMinor,
        currency,
        fuelType: dashboard.vehicle.fuel_type,
        isFullTank: fuelIsFull,
      });
      if (result.ok) {
        setFuelEntries((prev) => [result.value, ...prev]);
        setShowFuelDialog(false);
      } else {
        setFuelError(result.error.message);
      }
    });
  }

  // ── Expense dialog ───────────────────────────────────────────────────────

  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("repair");
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseError, setExpenseError] = useState<string | null>(null);

  function handleAddExpense() {
    const amountMinor = Math.round(parseFloat(expenseAmount) * 100);
    if (isNaN(amountMinor) || amountMinor <= 0) { setExpenseError("Enter a valid amount."); return; }
    setExpenseError(null);
    startTransition(async () => {
      const result = await createVehicleExpenseAction({
        vehicleId,
        occurredAt: expenseDate,
        amountMinor,
        currency,
        expenseCategory,
        description: expenseDesc.trim() || null,
      });
      if (result.ok) {
        setExpenses((prev) => [result.value, ...prev]);
        setShowExpenseDialog(false);
      } else {
        setExpenseError(result.error.message);
      }
    });
  }

  // ── Maintenance dialog ───────────────────────────────────────────────────

  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false);
  const [maintTitle, setMaintTitle] = useState("");
  const [maintCategory, setMaintCategory] = useState("service");
  const [maintDate, setMaintDate] = useState(new Date().toISOString().slice(0, 10));
  const [maintCost, setMaintCost] = useState("");
  const [maintNextDate, setMaintNextDate] = useState("");
  const [maintError, setMaintError] = useState<string | null>(null);

  function handleAddMaintenance() {
    if (!maintTitle.trim()) { setMaintError("Title is required."); return; }
    const costMinor = maintCost ? Math.round(parseFloat(maintCost) * 100) : null;
    setMaintError(null);
    startTransition(async () => {
      const result = await createMaintenanceRecordAction({
        vehicleId,
        title: maintTitle.trim(),
        maintenanceCategory: maintCategory,
        servicedAt: maintDate || null,
        costMinor: costMinor ?? null,
        currency: costMinor !== null ? currency : null,
        nextDueDate: maintNextDate || null,
      });
      if (result.ok) {
        setMaintenance((prev) => [result.value, ...prev]);
        setShowMaintenanceDialog(false);
      } else {
        setMaintError(result.error.message);
      }
    });
  }

  // ── Document dialog ──────────────────────────────────────────────────────

  const [showDocDialog, setShowDocDialog] = useState(false);
  const [docType, setDocType] = useState<"insurance" | "puc" | "rc" | "road_tax" | "permit" | "warranty" | "other">("insurance");
  const [docTitle, setDocTitle] = useState("");
  const [docExpiry, setDocExpiry] = useState("");
  const [docError, setDocError] = useState<string | null>(null);

  function handleAddDocument() {
    if (!docTitle.trim()) { setDocError("Title is required."); return; }
    setDocError(null);
    startTransition(async () => {
      const result = await createVehicleDocumentAction({
        vehicleId,
        documentType: docType,
        title: docTitle.trim(),
        expiryDate: docExpiry || null,
        reminderDaysBefore: [30, 7, 1],
      });
      if (result.ok) {
        setDocuments((prev) => [result.value, ...prev]);
        setShowDocDialog(false);
      } else {
        setDocError(result.error.message);
      }
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Hero header card */}
      <div className="rounded-2xl bg-teal-950 border border-teal-900 p-5">
        <div className="flex items-start gap-3 mb-3">
          <button
            onClick={() => router.push("/vehicles")}
            className="mt-0.5 size-8 rounded-full bg-teal-900 hover:bg-teal-800 flex items-center justify-center text-teal-300 transition-colors shrink-0"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-xl leading-tight">{dashboard.vehicle.name}</h1>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className="text-xs bg-teal-900 text-teal-300 px-2 py-0.5 rounded-full capitalize">
                {dashboard.vehicle.vehicle_type}
              </span>
              <span className="text-xs bg-teal-900 text-teal-300 px-2 py-0.5 rounded-full capitalize">
                {dashboard.vehicle.fuel_type}
              </span>
              {dashboard.vehicle.registration_number && (
                <span className="text-xs bg-teal-900/50 text-teal-400 px-2 py-0.5 rounded-full font-mono tracking-widest">
                  {dashboard.vehicle.registration_number}
                </span>
              )}
            </div>
          </div>
        </div>
        {dashboard.vehicle.current_odometer != null && dashboard.vehicle.current_odometer > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-teal-900">
            <Gauge className="size-4 text-teal-500" />
            <span className="text-teal-300 text-sm font-medium tabular-nums">
              {fmtOdometer(dashboard.vehicle.current_odometer)}
            </span>
            <span className="text-teal-700 text-xs">last odometer</span>
          </div>
        )}
      </div>

      {/* Key stats — 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        <TealStatCard
          label="Total fuel cost"
          value={fmtAmount(dashboard.totalFuelCostMinor, currency, masked)}
          Icon={Fuel}
        />
        <TealStatCard
          label="Fuel efficiency"
          value={
            efficiency.type === "computed"
              ? `${(efficiency.kmPerLitreCx100 / 100).toFixed(1)} km/L`
              : "—"
          }
          Icon={Activity}
          highlight
        />
        <TealStatCard
          label="Cost per km"
          value={
            costPerKm.type === "computed" && !masked
              ? `${fmtAmount(costPerKm.costPerKmCx100 / 100, currency, false)}/km`
              : costPerKm.type === "computed"
              ? "***"
              : "—"
          }
          Icon={TrendingUp}
        />
        <TealStatCard
          label="Total fill-ups"
          value={String(fuelEntries.length)}
          Icon={BarChart3}
          highlight
        />
      </div>

      {/* Horizontal tab bar */}
      <div className="overflow-x-auto -mx-1 px-1 pb-px">
        <div className="flex gap-0 min-w-max border-b border-teal-900/60">
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={[
                  "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "text-teal-400" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="size-3.5" />
                {label}
                {id === "reminders" && reminders.length > 0 && (
                  <span className="size-[18px] rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold leading-none">
                    {reminders.length}
                  </span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab contents */}
      <div className="min-h-52">

        {/* ── Fuel Log ── */}
        {activeTab === "fuel" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {fuelEntries.length} fill-up{fuelEntries.length !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-teal-800 text-teal-400 hover:bg-teal-950 hover:text-teal-300 text-xs"
                  onClick={() => router.push(`/vehicles/${vehicleId}/import`)}
                >
                  Import CSV
                </Button>
                <Button
                  size="sm"
                  className="bg-teal-500 hover:bg-teal-400 text-teal-950 font-semibold text-xs"
                  onClick={() => setShowFuelDialog(true)}
                >
                  <Plus className="size-3.5 mr-1" /> Log fuel
                </Button>
              </div>
            </div>

            {fuelEntries.length === 0 ? (
              <TealEmptyState Icon={Fuel} message="No fuel entries yet. Log your first fill-up or import a CSV." />
            ) : (
              fuelByMonth.map(({ month, label, entries }) => (
                <div key={month}>
                  <MonthDivider label={label} />
                  <div className="space-y-2 mt-3">
                    {entries.map((e) => (
                      <div
                        key={e.id}
                        className="bg-teal-950 rounded-xl border border-teal-900/50 p-4 flex gap-3 group hover:border-teal-800/80 transition-colors"
                      >
                        {/* Icon */}
                        <div className="size-9 rounded-full bg-teal-900 flex items-center justify-center shrink-0 mt-0.5">
                          <Fuel className="size-4 text-teal-400" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className="text-white text-sm font-medium">Refueling</span>
                              {e.is_full_tank && (
                                <span className="ml-2 text-teal-500 text-xs">Full tank</span>
                              )}
                              {e.is_missed && (
                                <span className="ml-2 text-amber-400 text-xs">Missed</span>
                              )}
                              <p className="text-teal-600 text-xs mt-0.5">{fmtDateShort(e.occurred_at)}</p>
                            </div>
                            {e.total_cost_minor != null && (
                              <p className="text-white font-bold text-base tabular-nums shrink-0 leading-none mt-0.5">
                                {fmtAmount(Number(e.total_cost_minor), e.currency, masked)}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-teal-500">
                            <span className="flex items-center gap-1">
                              <Gauge className="size-3 text-teal-700" />
                              {fmtOdometer(Number(e.odometer))}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="size-1.5 rounded-full bg-teal-700 inline-block" />
                              {fmtLitres(Number(e.fuel_quantity_ml))}
                            </span>
                            {e.notes && <span className="text-teal-700 italic">{e.notes}</span>}
                          </div>
                        </div>

                        {/* Delete */}
                        <button
                          disabled={isPending}
                          className="size-6 rounded text-transparent group-hover:text-teal-700 hover:!text-red-400 hover:bg-teal-900 flex items-center justify-center transition-all shrink-0 mt-0.5"
                          onClick={() => {
                            if (confirm("Delete this fuel entry?")) {
                              startTransition(async () => {
                                const r = await deleteFuelEntryAction(vehicleId, e.id);
                                if (r.ok) setFuelEntries((prev) => prev.filter((x) => x.id !== e.id));
                              });
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Expenses ── */}
        {activeTab === "expenses" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {expenses.length} expense{expenses.length !== 1 ? "s" : ""}
              </span>
              <Button
                size="sm"
                className="bg-teal-500 hover:bg-teal-400 text-teal-950 font-semibold text-xs"
                onClick={() => setShowExpenseDialog(true)}
              >
                <Plus className="size-3.5 mr-1" /> Add expense
              </Button>
            </div>

            {expenses.length === 0 ? (
              <TealEmptyState Icon={DollarSign} message="No expenses recorded yet." />
            ) : (
              expensesByMonth.map(({ month, label, entries }) => (
                <div key={month}>
                  <MonthDivider label={label} />
                  <div className="space-y-2 mt-3">
                    {entries.map((e) => (
                      <div
                        key={e.id}
                        className="bg-teal-950 rounded-xl border border-teal-900/50 p-4 flex gap-3 group hover:border-teal-800/80 transition-colors"
                      >
                        <div className="size-9 rounded-full bg-teal-900 flex items-center justify-center shrink-0 mt-0.5">
                          <DollarSign className="size-4 text-teal-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-white text-sm font-medium capitalize">{e.expense_category}</p>
                              <p className="text-teal-600 text-xs mt-0.5">{fmtDateShort(e.occurred_at)}</p>
                            </div>
                            <p className="text-white font-bold text-base tabular-nums shrink-0 leading-none mt-0.5">
                              {fmtAmount(Number(e.amount_minor), e.currency, masked)}
                            </p>
                          </div>
                          {e.description && (
                            <p className="text-teal-600 text-xs mt-1.5 italic">{e.description}</p>
                          )}
                        </div>
                        <button
                          disabled={isPending}
                          className="size-6 rounded text-transparent group-hover:text-teal-700 hover:!text-red-400 hover:bg-teal-900 flex items-center justify-center transition-all shrink-0 mt-0.5"
                          onClick={() => {
                            if (confirm("Delete this expense?")) {
                              startTransition(async () => {
                                const r = await deleteVehicleExpenseAction(vehicleId, e.id);
                                if (r.ok) setExpenses((prev) => prev.filter((x) => x.id !== e.id));
                              });
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Maintenance ── */}
        {activeTab === "maintenance" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                size="sm"
                className="bg-teal-500 hover:bg-teal-400 text-teal-950 font-semibold text-xs"
                onClick={() => setShowMaintenanceDialog(true)}
              >
                <Plus className="size-3.5 mr-1" /> Add record
              </Button>
            </div>

            {maintenance.length === 0 ? (
              <TealEmptyState Icon={Wrench} message="No service records yet." />
            ) : (
              <div className="space-y-2">
                {maintenance.map((m) => (
                  <div
                    key={m.id}
                    className="bg-teal-950 rounded-xl border border-teal-900/50 p-4 flex gap-3 group hover:border-teal-800/80 transition-colors"
                  >
                    <div className="size-9 rounded-full bg-teal-900 flex items-center justify-center shrink-0 mt-0.5">
                      <Wrench className="size-4 text-teal-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-white text-sm font-medium">{m.title}</p>
                          <div className="flex flex-wrap gap-2 mt-1 text-xs text-teal-500">
                            <span className="capitalize">{m.maintenance_category.replace("_", " ")}</span>
                            {m.serviced_at && <span>· {m.serviced_at}</span>}
                            {m.next_due_date && (
                              <span className="text-teal-400">· Next: {m.next_due_date}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {m.cost_minor != null && m.currency && (
                            <p className="text-white font-bold text-sm tabular-nums">
                              {fmtAmount(Number(m.cost_minor), m.currency, masked)}
                            </p>
                          )}
                          {m.status === "overdue" && (
                            <span className="text-xs text-red-400 font-medium">Overdue</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      disabled={isPending}
                      className="size-6 rounded text-transparent group-hover:text-teal-700 hover:!text-red-400 hover:bg-teal-900 flex items-center justify-center transition-all shrink-0 mt-0.5"
                      onClick={() => {
                        if (confirm("Delete this maintenance record?")) {
                          startTransition(async () => {
                            const r = await deleteMaintenanceRecordAction(vehicleId, m.id);
                            if (r.ok) setMaintenance((prev) => prev.filter((x) => x.id !== m.id));
                          });
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Documents ── */}
        {activeTab === "documents" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                size="sm"
                className="bg-teal-500 hover:bg-teal-400 text-teal-950 font-semibold text-xs"
                onClick={() => setShowDocDialog(true)}
              >
                <Plus className="size-3.5 mr-1" /> Add document
              </Button>
            </div>

            {documents.length === 0 ? (
              <TealEmptyState Icon={FileText} message="No documents added yet." />
            ) : (
              <div className="space-y-2">
                {documents.map((d) => {
                  const daysLeft = d.expiry_date ? daysUntil(d.expiry_date) : null;
                  const urgency =
                    daysLeft === null ? "none"
                    : daysLeft < 0 ? "expired"
                    : daysLeft <= 7 ? "urgent"
                    : daysLeft <= 30 ? "warning" : "ok";
                  return (
                    <div
                      key={d.id}
                      className="bg-teal-950 rounded-xl border border-teal-900/50 p-4 flex gap-3 group hover:border-teal-800/80 transition-colors"
                    >
                      <div className={[
                        "size-9 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                        urgency === "expired" || urgency === "urgent" ? "bg-red-950" : "bg-teal-900",
                      ].join(" ")}>
                        <FileText className={[
                          "size-4",
                          urgency === "expired" || urgency === "urgent" ? "text-red-400" : "text-teal-400",
                        ].join(" ")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-white text-sm font-medium">{d.title}</p>
                            <p className="text-teal-600 text-xs mt-0.5 uppercase tracking-wide">
                              {d.document_type.replace("_", " ")}
                            </p>
                          </div>
                          {d.expiry_date && (
                            <div className="text-right shrink-0">
                              <p className={[
                                "text-xs font-semibold",
                                urgency === "expired" ? "text-red-400"
                                : urgency === "urgent" ? "text-red-300"
                                : urgency === "warning" ? "text-amber-400"
                                : "text-teal-400",
                              ].join(" ")}>
                                {urgency === "expired" ? "Expired"
                                : urgency === "urgent" || urgency === "warning" ? `${daysLeft}d left`
                                : "Valid"}
                              </p>
                              <p className="text-teal-700 text-xs mt-0.5">{d.expiry_date}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        disabled={isPending}
                        className="size-6 rounded text-transparent group-hover:text-teal-700 hover:!text-red-400 hover:bg-teal-900 flex items-center justify-center transition-all shrink-0 mt-0.5"
                        onClick={() => {
                          if (confirm("Delete this document record?")) {
                            startTransition(async () => {
                              const r = await deleteVehicleDocumentAction(vehicleId, d.id);
                              if (r.ok) setDocuments((prev) => prev.filter((x) => x.id !== d.id));
                            });
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Reminders ── */}
        {activeTab === "reminders" && (
          <div className="space-y-2">
            {reminders.length === 0 ? (
              <TealEmptyState Icon={Bell} message="No active reminders." />
            ) : (
              reminders.map((r) => {
                const daysLeft = r.due_date ? daysUntil(r.due_date) : null;
                const isUrgent = daysLeft !== null && daysLeft <= 7;
                return (
                  <div
                    key={r.id}
                    className="bg-teal-950 rounded-xl border border-teal-900/50 p-4 flex items-start gap-3 hover:border-teal-800/80 transition-colors"
                  >
                    <div className={[
                      "size-9 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      isUrgent ? "bg-red-950" : "bg-teal-900",
                    ].join(" ")}>
                      <Bell className={["size-4", isUrgent ? "text-red-400" : "text-teal-400"].join(" ")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{r.title}</p>
                      <p className="text-teal-600 text-xs mt-0.5 capitalize">
                        {r.reminder_type.replace("_", " ")}
                      </p>
                      {r.due_date && (
                        <p className={[
                          "text-xs mt-1 font-medium",
                          daysLeft !== null && daysLeft < 0 ? "text-red-400" : "text-teal-400",
                        ].join(" ")}>
                          Due {r.due_date}
                          {daysLeft !== null && (
                            daysLeft < 0 ? " · Overdue"
                            : daysLeft === 0 ? " · Today"
                            : ` · ${daysLeft}d`
                          )}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-7 text-xs border-teal-800 text-teal-400 hover:bg-teal-900 hover:text-teal-300"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          const res = await dismissVehicleReminderAction(r.id);
                          if (res.ok) setReminders((prev) => prev.filter((x) => x.id !== r.id));
                        });
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Analytics ── */}
        {activeTab === "analytics" && (
          <div className="space-y-4">

            {/* Monthly cost bar chart */}
            <div className="bg-teal-950 rounded-2xl border border-teal-900 p-5">
              <p className="text-teal-500 text-xs font-semibold uppercase tracking-widest mb-5">
                Monthly Costs
              </p>
              {chartData.length === 0 ? (
                <p className="text-teal-600 text-sm">No monthly data yet.</p>
              ) : (
                <>
                  <div className="flex items-end gap-1.5 h-32">
                    {chartData.map((m) => (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full">
                        <div className="flex-1 w-full flex flex-col justify-end">
                          <div
                            className="w-full bg-teal-400 rounded-t-md min-h-[3px] transition-all"
                            style={{ height: `${(m.totalCostMinor / maxBar) * 100}%` }}
                          />
                        </div>
                        <span className="text-teal-700 text-[10px] tabular-nums">
                          {m.month.slice(5)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 space-y-2 border-t border-teal-900 pt-4">
                    {[...chartData].reverse().map((m) => (
                      <div key={m.month} className="flex items-center justify-between text-xs">
                        <span className="text-teal-500">{formatMonthLabel(m.month)}</span>
                        <span className="text-white font-semibold tabular-nums">
                          {fmtAmount(m.totalCostMinor, currency, masked)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Efficiency */}
            <div className="bg-teal-950 rounded-2xl border border-teal-900 p-5">
              <p className="text-teal-500 text-xs font-semibold uppercase tracking-widest mb-4">
                Fuel Efficiency
              </p>
              {efficiency.type === "computed" ? (
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-bold text-3xl tabular-nums">
                      {(efficiency.kmPerLitreCx100 / 100).toFixed(2)}
                    </span>
                    <span className="text-teal-400 text-base">km/L</span>
                  </div>
                  <p className="text-teal-600 text-xs mt-1.5">
                    Calculated from {efficiency.intervalCount} full-tank interval
                    {efficiency.intervalCount !== 1 ? "s" : ""}
                  </p>
                </div>
              ) : (
                <p className="text-teal-600 text-sm leading-relaxed">
                  Requires at least two consecutive full-tank fill-ups.
                </p>
              )}
            </div>

            {/* Cost summary */}
            <div className="bg-teal-950 rounded-2xl border border-teal-900 p-5">
              <p className="text-teal-500 text-xs font-semibold uppercase tracking-widest mb-4">
                Cost Breakdown
              </p>
              <div className="space-y-3">
                <SummaryRow label="Fuel" value={fmtAmount(dashboard.totalFuelCostMinor, currency, masked)} />
                <div className="h-px bg-teal-900" />
                <SummaryRow label="Other expenses" value={fmtAmount(dashboard.totalOtherCostMinor, currency, masked)} />
                <div className="h-px bg-teal-900" />
                <SummaryRow
                  label="Total"
                  value={fmtAmount(dashboard.totalCostMinor, currency, masked)}
                  bold
                />
                {costPerKm.type === "computed" && (
                  <>
                    <div className="h-px bg-teal-900" />
                    <SummaryRow
                      label="Cost per km"
                      value={masked ? "***" : `${fmtAmount(costPerKm.costPerKmCx100 / 100, currency, false)}/km`}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Fuel dialog ── */}
      <Dialog open={showFuelDialog} onOpenChange={setShowFuelDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Log fuel entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={fuelDate} onChange={(e) => setFuelDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Odometer (km) *</Label>
                <Input type="number" min="0" step="0.1" placeholder="e.g. 3257.0" value={fuelOdometer} onChange={(e) => setFuelOdometer(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fuel (litres) *</Label>
                <Input type="number" min="0.001" step="0.01" placeholder="e.g. 10.08" value={fuelLitres} onChange={(e) => setFuelLitresState(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Total cost</Label>
                <Input type="number" min="0" step="0.01" placeholder="e.g. 1174.82" value={fuelCost} onChange={(e) => setFuelCost(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="full-tank" checked={fuelIsFull} onCheckedChange={(v) => setFuelIsFull(v === true)} />
              <Label htmlFor="full-tank">Filled to full tank</Label>
            </div>
            {fuelError && <p className="text-sm text-destructive">{fuelError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFuelDialog(false)}>Cancel</Button>
            <Button onClick={handleAddFuel} disabled={isPending}>{isPending ? "Saving…" : "Log entry"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Expense dialog ── */}
      <Dialog open={showExpenseDialog} onOpenChange={setShowExpenseDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add vehicle expense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount *</Label>
                <Input type="number" min="0" step="0.01" placeholder="e.g. 500.00" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="repair">Repair</SelectItem>
                  <SelectItem value="accessories">Accessories</SelectItem>
                  <SelectItem value="tyres">Tyres</SelectItem>
                  <SelectItem value="cleaning">Cleaning</SelectItem>
                  <SelectItem value="parking">Parking</SelectItem>
                  <SelectItem value="toll">Toll</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input placeholder="Optional note" value={expenseDesc} onChange={(e) => setExpenseDesc(e.target.value)} />
            </div>
            {expenseError && <p className="text-sm text-destructive">{expenseError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExpenseDialog(false)}>Cancel</Button>
            <Button onClick={handleAddExpense} disabled={isPending}>{isPending ? "Saving…" : "Add expense"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Maintenance dialog ── */}
      <Dialog open={showMaintenanceDialog} onOpenChange={setShowMaintenanceDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add maintenance record</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input placeholder="e.g. Oil change" value={maintTitle} onChange={(e) => setMaintTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={maintCategory} onValueChange={setMaintCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="oil_change">Oil change</SelectItem>
                    <SelectItem value="tyre_rotation">Tyre rotation</SelectItem>
                    <SelectItem value="tyre_replacement">Tyre replacement</SelectItem>
                    <SelectItem value="brake_service">Brake service</SelectItem>
                    <SelectItem value="battery">Battery</SelectItem>
                    <SelectItem value="chain">Chain</SelectItem>
                    <SelectItem value="filter">Filter</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Service date</Label>
                <Input type="date" value={maintDate} onChange={(e) => setMaintDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cost</Label>
                <Input type="number" min="0" step="0.01" placeholder="e.g. 2500" value={maintCost} onChange={(e) => setMaintCost(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Next due date</Label>
                <Input type="date" value={maintNextDate} onChange={(e) => setMaintNextDate(e.target.value)} />
              </div>
            </div>
            {maintError && <p className="text-sm text-destructive">{maintError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMaintenanceDialog(false)}>Cancel</Button>
            <Button onClick={handleAddMaintenance} disabled={isPending}>{isPending ? "Saving…" : "Add record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Document dialog ── */}
      <Dialog open={showDocDialog} onOpenChange={setShowDocDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add document</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={docType} onValueChange={(v) => setDocType(v as typeof docType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="insurance">Insurance</SelectItem>
                    <SelectItem value="puc">PUC</SelectItem>
                    <SelectItem value="rc">RC</SelectItem>
                    <SelectItem value="road_tax">Road tax</SelectItem>
                    <SelectItem value="permit">Permit</SelectItem>
                    <SelectItem value="warranty">Warranty</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Expiry date</Label>
                <Input type="date" value={docExpiry} onChange={(e) => setDocExpiry(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input placeholder="e.g. Two-wheeler insurance" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
            </div>
            {docError && <p className="text-sm text-destructive">{docError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDocDialog(false)}>Cancel</Button>
            <Button onClick={handleAddDocument} disabled={isPending}>{isPending ? "Saving…" : "Add document"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TealStatCard({
  label,
  value,
  Icon,
  highlight = false,
}: {
  label: string;
  value: string;
  Icon: React.ElementType;
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-4 space-y-1",
        highlight
          ? "bg-teal-900 border-teal-800"
          : "bg-teal-950 border-teal-900",
      ].join(" ")}
    >
      <Icon className="size-4 text-teal-400 mb-2" />
      <p className="text-white font-bold text-lg tabular-nums leading-none">{value}</p>
      <p className="text-teal-600 text-xs">{label}</p>
    </div>
  );
}

function MonthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-teal-400 text-xs font-semibold uppercase tracking-widest whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-teal-900" />
    </div>
  );
}

function TealEmptyState({
  Icon,
  message,
}: {
  Icon: React.ElementType;
  message: string;
}) {
  return (
    <div className="bg-teal-950 rounded-2xl border border-teal-900 flex flex-col items-center gap-3 py-14 px-6 text-center">
      <div className="size-14 rounded-full bg-teal-900 flex items-center justify-center">
        <Icon className="size-6 text-teal-700" />
      </div>
      <p className="text-teal-600 text-sm max-w-xs">{message}</p>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={["text-sm", bold ? "text-teal-300 font-semibold" : "text-teal-500"].join(" ")}>
        {label}
      </span>
      <span className={["tabular-nums text-sm", bold ? "text-teal-300 font-bold" : "text-white font-medium"].join(" ")}>
        {value}
      </span>
    </div>
  );
}

// Suppress unused import warning — Bike kept for future vehicle type icons
void Bike;
void Car;
