"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Fuel, Wrench, FileText, Bell, DollarSign, BarChart3,
  Plus, Trash2, Gauge, Pencil, Link2, X,
} from "lucide-react";
import type {
  VehicleMaintenanceRow,
  VehicleDocumentRow,
  VehicleReminderRow,
} from "@spencare/domain-application";
import type { VehicleDashboardData } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { formatMinorUnits } from "@/lib/currency-format";
import type { TransactionRow } from "@spencare/domain-application";
import {
  createFuelEntryAction,
  updateFuelEntryAction,
  deleteFuelEntryAction,
  createVehicleExpenseAction,
  deleteVehicleExpenseAction,
  createMaintenanceRecordAction,
  deleteMaintenanceRecordAction,
  createVehicleDocumentAction,
  deleteVehicleDocumentAction,
  dismissVehicleReminderAction,
} from "../actions";
import { LinkTransactionDialog } from "../link-transaction-dialog";

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

function fmtDateFull(dateStr: string): string {
  // occurred_at is timestamptz — Supabase returns full ISO string; just parse it directly
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
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

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function prevYearMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

// ── Tab config ─────────────────────────────────────────────────────────────

type TabId = "fuel" | "expenses" | "analytics" | "service";

const TABS: { id: TabId; label: string; Icon: React.ElementType }[] = [
  { id: "fuel", label: "Fuel Log", Icon: Fuel },
  { id: "expenses", label: "Expenses", Icon: DollarSign },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
  { id: "service", label: "Service & Docs", Icon: Wrench },
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

  // ── Derived metrics ──────────────────────────────────────────────────────

  const totalLitres = useMemo(
    () => fuelEntries.reduce((acc, e) => acc + Number(e.fuel_quantity_ml), 0) / 1000,
    [fuelEntries]
  );

  // Total distance = max odometer - min odometer across all entries
  const totalDistanceKm = useMemo(() => {
    if (fuelEntries.length < 2) return null;
    const odos = fuelEntries.map((e) => Number(e.odometer) / 10);
    const dist = Math.max(...odos) - Math.min(...odos);
    return dist > 0 ? dist : null;
  }, [fuelEntries]);

  // Simple overall km/L = total distance / total fuel — always computable, no full-tank requirement
  const simpleKmPerL = useMemo(() => {
    if (efficiency.type === "computed") return null; // server-side is preferred
    if (!totalDistanceKm || totalLitres <= 0) return null;
    return totalDistanceKm / totalLitres;
  }, [efficiency, totalDistanceKm, totalLitres]);

  // Per-fill-up km/L: for each entry (descending), compute vs previous fill-up
  const kmPerLPerEntry = useMemo(() => {
    const map = new Map<string, number | null>();
    const ascending = [...fuelEntries].reverse();
    for (let i = 1; i < ascending.length; i++) {
      const curr = ascending[i];
      const prev = ascending[i - 1];
      const distKm = (Number(curr.odometer) - Number(prev.odometer)) / 10;
      const litres = Number(curr.fuel_quantity_ml) / 1000;
      map.set(curr.id, distKm > 0 && litres > 0 ? distKm / litres : null);
    }
    return map;
  }, [fuelEntries]);

  const avgKmPerFillup = useMemo(() => {
    if (!totalDistanceKm || fuelEntries.length < 2) return null;
    return totalDistanceKm / (fuelEntries.length - 1);
  }, [totalDistanceKm, fuelEntries]);

  const fuelPricesPerL = useMemo(() =>
    fuelEntries
      .filter((e) => e.total_cost_minor != null && Number(e.fuel_quantity_ml) > 0)
      .map((e) => (Number(e.total_cost_minor!) / 100) / (Number(e.fuel_quantity_ml) / 1000)),
    [fuelEntries]
  );
  const lastFuelPricePerL = fuelPricesPerL[0] ?? null;
  const bestFuelPricePerL = fuelPricesPerL.length > 0 ? Math.min(...fuelPricesPerL) : null;
  const worstFuelPricePerL = fuelPricesPerL.length > 1 ? Math.max(...fuelPricesPerL) : null;

  const thisYear = new Date().getFullYear().toString();
  const thisYearMonths = useMemo(
    () => dashboard.monthlyCosts.filter((m) => m.month.startsWith(thisYear)),
    [dashboard.monthlyCosts]
  );
  const thisYearFuelCostMinor = thisYearMonths.reduce((a, m) => a + m.fuelCostMinor, 0);
  const thisYearLitres = thisYearMonths.reduce((a, m) => a + m.fuelLitresMl, 0) / 1000;

  const avgCostPerMonth = useMemo(() => {
    if (!dashboard.monthlyCosts.length) return null;
    return dashboard.monthlyCosts.reduce((a, m) => a + m.totalCostMinor, 0) / dashboard.monthlyCosts.length;
  }, [dashboard.monthlyCosts]);

  // Distance delta: entry id -> km driven since previous fill-up
  const distanceDeltaMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (let i = 0; i < fuelEntries.length; i++) {
      const curr = Number(fuelEntries[i].odometer) / 10;
      const prev = i < fuelEntries.length - 1 ? Number(fuelEntries[i + 1].odometer) / 10 : null;
      map.set(fuelEntries[i].id, prev !== null ? curr - prev : null);
    }
    return map;
  }, [fuelEntries]);

  const thisMonthCosts = dashboard.monthlyCosts.find((m) => m.month === currentYearMonth());
  const prevMonthCosts = dashboard.monthlyCosts.find((m) => m.month === prevYearMonth());

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

  const minFillupL = useMemo(
    () => fuelEntries.length > 0 ? Math.min(...fuelEntries.map((e) => Number(e.fuel_quantity_ml) / 1000)) : null,
    [fuelEntries]
  );
  const maxFillupL = useMemo(
    () => fuelEntries.length > 0 ? Math.max(...fuelEntries.map((e) => Number(e.fuel_quantity_ml) / 1000)) : null,
    [fuelEntries]
  );

  // Per fill-up efficiency trend (any consecutive fill-up, ascending order for chart)
  const efficiencyTrend = useMemo(() => {
    const ascending = [...fuelEntries].reverse();
    const points: { label: string; kmPerL: number }[] = [];
    for (let i = 1; i < ascending.length; i++) {
      const curr = ascending[i];
      const prev = ascending[i - 1];
      const distKm = (Number(curr.odometer) - Number(prev.odometer)) / 10;
      const litres = Number(curr.fuel_quantity_ml) / 1000;
      if (distKm > 0 && litres > 0) {
        points.push({ label: curr.occurred_at.slice(5, 10), kmPerL: distKm / litres });
      }
    }
    return points.slice(-8);
  }, [fuelEntries]);

  // Price per litre trend (ascending date order for chart)
  const priceTrend = useMemo(() => {
    return [...fuelEntries]
      .filter((e) => e.total_cost_minor != null && Number(e.fuel_quantity_ml) > 0)
      .reverse()
      .slice(-8)
      .map((e) => ({
        label: e.occurred_at.slice(5, 10),
        pricePerL: (Number(e.total_cost_minor!) / 100) / (Number(e.fuel_quantity_ml) / 1000),
      }));
  }, [fuelEntries]);

  // Monthly trend: last vs prev change %
  const monthlyTrendStats = useMemo(() => {
    if (chartData.length < 2) return null;
    const last = chartData[chartData.length - 1].totalCostMinor;
    const prev = chartData[chartData.length - 2].totalCostMinor;
    const avg = chartData.reduce((a, m) => a + m.totalCostMinor, 0) / chartData.length;
    const changePct = prev > 0 ? ((last - prev) / prev * 100) : 0;
    return { last, avg, changePct };
  }, [chartData]);

  // ── Fuel dialog ──────────────────────────────────────────────────────────

  const [showFuelDialog, setShowFuelDialog] = useState(false);
  const [editingFuelId, setEditingFuelId] = useState<string | null>(null);
  const [fuelDate, setFuelDate] = useState(new Date().toISOString().slice(0, 10));
  const [fuelOdometer, setFuelOdometer] = useState("");
  const [fuelLitres, setFuelLitresState] = useState("");
  const [fuelCost, setFuelCost] = useState("");
  const [fuelIsFull, setFuelIsFull] = useState(true);
  const [fuelError, setFuelError] = useState<string | null>(null);

  function openEditFuel(e: (typeof fuelEntries)[number]) {
    setEditingFuelId(e.id);
    setFuelDate(new Date(e.occurred_at).toISOString().slice(0, 10));
    setFuelOdometer((Number(e.odometer) / 10).toFixed(1));
    setFuelLitresState((Number(e.fuel_quantity_ml) / 1000).toFixed(2));
    setFuelCost(e.total_cost_minor != null ? (Number(e.total_cost_minor) / 100).toFixed(2) : "");
    setFuelIsFull(e.is_full_tank);
    setFuelError(null);
    setShowFuelDialog(true);
  }

  function resetFuelForm() {
    setEditingFuelId(null);
    setFuelDate(new Date().toISOString().slice(0, 10));
    setFuelOdometer("");
    setFuelLitresState("");
    setFuelCost("");
    setFuelIsFull(true);
    setFuelError(null);
  }

  function handleAddFuel() {
    const odoTenths = Math.round(parseFloat(fuelOdometer) * 10);
    const fuelMl = Math.round(parseFloat(fuelLitres) * 1000);
    const costMinor = fuelCost ? Math.round(parseFloat(fuelCost) * 100) : null;
    if (isNaN(odoTenths) || odoTenths < 0) { setFuelError("Enter a valid odometer reading."); return; }
    if (isNaN(fuelMl) || fuelMl <= 0) { setFuelError("Enter a valid fuel quantity."); return; }
    setFuelError(null);

    if (editingFuelId) {
      startTransition(async () => {
        const result = await updateFuelEntryAction({
          entryId: editingFuelId, vehicleId, occurredAt: fuelDate, odometer: odoTenths,
          fuelQuantityMl: fuelMl, totalCostMinor: costMinor,
          currency, fuelType: dashboard.vehicle.fuel_type, isFullTank: fuelIsFull,
        });
        if (result.ok) {
          setFuelEntries((prev) => prev.map((x) => x.id === editingFuelId ? result.value : x));
          setShowFuelDialog(false);
          resetFuelForm();
        } else { setFuelError(result.error.message); }
      });
    } else {
      startTransition(async () => {
        const result = await createFuelEntryAction({
          vehicleId, occurredAt: fuelDate, odometer: odoTenths,
          fuelQuantityMl: fuelMl, totalCostMinor: costMinor,
          currency, fuelType: dashboard.vehicle.fuel_type, isFullTank: fuelIsFull,
        });
        if (result.ok) { setFuelEntries((prev) => [result.value, ...prev]); setShowFuelDialog(false); resetFuelForm(); }
        else { setFuelError(result.error.message); }
      });
    }
  }

  // ── Expense dialog ───────────────────────────────────────────────────────

  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [showLinkTxnDialog, setShowLinkTxnDialog] = useState(false);
  const [linkedTxn, setLinkedTxn] = useState<TransactionRow | null>(null);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("repair");
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseError, setExpenseError] = useState<string | null>(null);

  function handleLinkTxn(txn: TransactionRow) {
    setLinkedTxn(txn);
    // Pre-fill amount and date from the selected transaction
    setExpenseAmount((txn.amount_minor / 100).toFixed(2));
    setExpenseDate(new Date(txn.occurred_at).toISOString().slice(0, 10));
    if (!expenseDesc) {
      const { displayTitle } = (() => {
        try { return { displayTitle: txn.item_name ?? txn.merchant ?? "" }; } catch { return { displayTitle: "" }; }
      })();
      if (displayTitle) setExpenseDesc(displayTitle);
    }
  }

  function resetExpenseForm() {
    setLinkedTxn(null);
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setExpenseAmount("");
    setExpenseCategory("repair");
    setExpenseDesc("");
    setExpenseError(null);
  }

  function handleAddExpense() {
    const amountMinor = Math.round(parseFloat(expenseAmount) * 100);
    if (isNaN(amountMinor) || amountMinor <= 0) { setExpenseError("Enter a valid amount."); return; }
    setExpenseError(null);
    startTransition(async () => {
      const result = await createVehicleExpenseAction({
        vehicleId, occurredAt: expenseDate, amountMinor,
        currency, expenseCategory, description: expenseDesc.trim() || null,
        transactionId: linkedTxn?.id ?? null,
      });
      if (result.ok) { setExpenses((prev) => [result.value, ...prev]); setShowExpenseDialog(false); resetExpenseForm(); }
      else { setExpenseError(result.error.message); }
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
        vehicleId, title: maintTitle.trim(), maintenanceCategory: maintCategory,
        servicedAt: maintDate || null, costMinor: costMinor ?? null,
        currency: costMinor !== null ? currency : null, nextDueDate: maintNextDate || null,
      });
      if (result.ok) { setMaintenance((prev) => [result.value, ...prev]); setShowMaintenanceDialog(false); }
      else { setMaintError(result.error.message); }
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
        vehicleId, documentType: docType, title: docTitle.trim(),
        expiryDate: docExpiry || null, reminderDaysBefore: [30, 7, 1],
      });
      if (result.ok) { setDocuments((prev) => [result.value, ...prev]); setShowDocDialog(false); }
      else { setDocError(result.error.message); }
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.push("/vehicles")}
          className="mt-1 size-8 rounded-full border bg-background hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-xl leading-tight">{dashboard.vehicle.name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full capitalize">
              {dashboard.vehicle.vehicle_type}
            </span>
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full capitalize">
              {dashboard.vehicle.fuel_type}
            </span>
            {dashboard.vehicle.registration_number && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono tracking-widest">
                {dashboard.vehicle.registration_number}
              </span>
            )}
          </div>
          {dashboard.vehicle.current_odometer != null && dashboard.vehicle.current_odometer > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
              <Gauge className="size-3.5" />
              <span className="tabular-nums">{fmtOdometer(dashboard.vehicle.current_odometer)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Hero metric: km/l ── */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-3">
                {dashboard.vehicle.fuel_type.toUpperCase()} EFFICIENCY
              </p>
              {efficiency.type === "computed" ? (
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-bold tabular-nums text-foreground">
                      {(efficiency.kmPerLitreCx100 / 100).toFixed(2)}
                    </span>
                    <span className="text-lg text-muted-foreground font-medium">km/l</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Average fuel consumption</p>
                </div>
              ) : simpleKmPerL != null ? (
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-bold tabular-nums text-foreground">
                      {simpleKmPerL.toFixed(2)}
                    </span>
                    <span className="text-lg text-muted-foreground font-medium">km/l</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Overall avg efficiency</p>
                </div>
              ) : (
                <div>
                  <p className="text-3xl font-bold text-muted-foreground">—</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Add fuel entries to see efficiency</p>
                </div>
              )}
            </div>
            <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Fuel className="size-5 text-primary" />
            </div>
          </div>

          {(totalDistanceKm != null || lastFuelPricePerL != null) && (
            <div className="mt-4 pt-4 border-t border-primary/10 flex items-center justify-between">
              {totalDistanceKm != null ? (
                <div>
                  <p className="text-sm font-semibold tabular-nums">{totalDistanceKm.toFixed(0)} km</p>
                  <p className="text-xs text-muted-foreground">Distance tracked</p>
                </div>
              ) : <div />}
              {lastFuelPricePerL != null && !masked && (
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {`${currency === "INR" ? "₹" : currency}${lastFuelPricePerL.toFixed(2)}/L`}
                  </p>
                  <p className="text-xs text-muted-foreground">Last fuel price</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Secondary stats 2×2 ── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Cost per km"
          value={costPerKm.type === "computed"
            ? `${currency === "INR" ? "₹" : currency}${(costPerKm.costPerKmCx100 / 100).toFixed(2)}/km`
            : "—"}
          Icon={Gauge}
        />
        <StatCard
          label="Distance tracked"
          value={totalDistanceKm != null ? `${totalDistanceKm.toFixed(0)} km` : "—"}
          Icon={BarChart3}
        />
        <StatCard label="Fill-ups" value={String(fuelEntries.length)} Icon={Fuel} />
        <StatCard label="Fuel cost" value={fmtAmount(dashboard.totalFuelCostMinor, currency, masked)} Icon={DollarSign} />
      </div>

      {/* ── This month vs Previous month ── */}
      {(thisMonthCosts || prevMonthCosts) && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
              Monthly costs
            </p>
            <div className="grid grid-cols-2 gap-4">
              <MonthCostCol
                label="This month"
                fuelCost={thisMonthCosts?.fuelCostMinor ?? 0}
                otherCost={thisMonthCosts?.otherCostMinor ?? 0}
                litresMl={thisMonthCosts?.fuelLitresMl ?? 0}
                currency={currency}
                masked={masked}
                highlight
              />
              <MonthCostCol
                label="Last month"
                fuelCost={prevMonthCosts?.fuelCostMinor ?? 0}
                otherCost={prevMonthCosts?.otherCostMinor ?? 0}
                litresMl={prevMonthCosts?.fuelLitresMl ?? 0}
                currency={currency}
                masked={masked}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Tab bar ── */}
      <div className="overflow-x-auto -mx-1 px-1 pb-px">
        <div className="flex min-w-max border-b">
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={[
                  "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="size-3.5" />
                {label}
                {id === "service" && reminders.length > 0 && (
                  <span className="size-[18px] rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center font-bold">
                    {reminders.length}
                  </span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab contents ── */}
      <div className="min-h-52">

        {/* Fuel Log */}
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
                  className="text-xs"
                  onClick={() => router.push(`/vehicles/${vehicleId}/import`)}
                >
                  Import CSV
                </Button>
                <Button size="sm" className="text-xs" onClick={() => { resetFuelForm(); setShowFuelDialog(true); }}>
                  <Plus className="size-3.5 mr-1" /> Log fuel
                </Button>
              </div>
            </div>

            {fuelEntries.length === 0 ? (
              <EmptyState Icon={Fuel} message="No fuel entries yet. Log your first fill-up or import a CSV." />
            ) : (
              fuelByMonth.map(({ month, label, entries }) => (
                <div key={month}>
                  <MonthDivider label={label} />
                  <div className="mt-3">
                    {entries.map((e, idx) => {
                      const delta = distanceDeltaMap.get(e.id);
                      const pricePerL = e.total_cost_minor != null && Number(e.fuel_quantity_ml) > 0
                        ? (Number(e.total_cost_minor) / 100) / (Number(e.fuel_quantity_ml) / 1000)
                        : null;
                      const kmPerL = kmPerLPerEntry.get(e.id) ?? null;
                      const isLast = idx === entries.length - 1;
                      return (
                        <div key={e.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="size-8 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 z-10">
                              <Fuel className="size-3.5 text-primary" />
                            </div>
                            {!isLast && <div className="w-px flex-1 bg-border mt-1 mb-1" />}
                          </div>
                          <div className={["flex-1", isLast ? "pb-1" : "pb-4"].join(" ")}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold leading-none">Refueling</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{fmtDateFull(e.occurred_at)}</p>
                              </div>
                              {e.total_cost_minor != null && (
                                <p className="text-sm font-bold tabular-nums shrink-0">
                                  {fmtAmount(Number(e.total_cost_minor), e.currency, masked)}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Gauge className="size-3" />
                                {fmtOdometer(Number(e.odometer))}
                                {delta != null && delta > 0 && (
                                  <span className="text-primary font-medium ml-0.5">+{delta.toFixed(1)} km</span>
                                )}
                              </span>
                              <span>{fmtLitres(Number(e.fuel_quantity_ml))}</span>
                              {pricePerL != null && !masked && (
                                <span className="font-medium">
                                  {currency === "INR" ? "₹" : currency}{pricePerL.toFixed(2)}/L
                                </span>
                              )}
                              {kmPerL != null && (
                                <span className="font-semibold text-primary">{kmPerL.toFixed(1)} km/L</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {e.is_full_tank && (
                                <span className="text-[10px] bg-primary/8 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                  Full tank
                                </span>
                              )}
                              {e.is_missed && (
                                <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full font-medium">
                                  Missed
                                </span>
                              )}
                              {e.notes && (
                                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full italic">
                                  {e.notes}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 mt-0.5 shrink-0">
                            <button
                              disabled={isPending}
                              className="size-6 rounded text-muted-foreground/50 hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-all"
                              onClick={() => openEditFuel(e)}
                              title="Edit"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              disabled={isPending}
                              className="size-6 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-all"
                              onClick={() => {
                                if (confirm("Delete this fuel entry?")) {
                                  startTransition(async () => {
                                    const r = await deleteFuelEntryAction(vehicleId, e.id);
                                    if (r.ok) setFuelEntries((prev) => prev.filter((x) => x.id !== e.id));
                                  });
                                }
                              }}
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Expenses */}
        {activeTab === "expenses" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {expenses.length} expense{expenses.length !== 1 ? "s" : ""}
              </span>
              <Button size="sm" className="text-xs" onClick={() => { resetExpenseForm(); setShowExpenseDialog(true); }}>
                <Plus className="size-3.5 mr-1" /> Add expense
              </Button>
            </div>
            {expenses.length === 0 ? (
              <EmptyState Icon={DollarSign} message="No expenses recorded yet." />
            ) : (
              expensesByMonth.map(({ month, label, entries }) => (
                <div key={month}>
                  <MonthDivider label={label} />
                  <div className="mt-3 space-y-1">
                    {entries.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 py-2 group">
                        <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <DollarSign className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between gap-2">
                            <p className="text-sm font-medium capitalize">{e.expense_category.replace("_", " ")}</p>
                            <p className="text-sm font-bold tabular-nums shrink-0">
                              {fmtAmount(Number(e.amount_minor), e.currency, masked)}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{fmtDateFull(e.occurred_at)}</p>
                          {e.description && (
                            <p className="text-xs text-muted-foreground italic mt-0.5">{e.description}</p>
                          )}
                        </div>
                        <button
                          disabled={isPending}
                          className="mt-0.5 size-6 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-all shrink-0"
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

        {/* Service & Docs — combined tab */}
        {activeTab === "service" && (
          <div className="space-y-6">

            {/* Reminders / Alerts */}
            {reminders.length > 0 && (
              <div className="space-y-2">
                <SectionHeader label="Alerts" count={reminders.length} />
                {reminders.map((r) => {
                  const daysLeft = r.due_date ? daysUntil(r.due_date) : null;
                  const isUrgent = daysLeft !== null && daysLeft <= 7;
                  return (
                    <Card key={r.id}>
                      <CardContent className="p-4 flex items-start gap-3">
                        <div className={[
                          "size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                          isUrgent ? "bg-destructive/10" : "bg-amber-500/10",
                        ].join(" ")}>
                          <Bell className={["size-3.5", isUrgent ? "text-destructive" : "text-amber-600"].join(" ")} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{r.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 capitalize">{r.reminder_type.replace("_", " ")}</p>
                          {r.due_date && (
                            <p className={["text-xs mt-1 font-medium", daysLeft !== null && daysLeft < 0 ? "text-destructive" : "text-muted-foreground"].join(" ")}>
                              Due {r.due_date}
                              {daysLeft !== null && (daysLeft < 0 ? " · Overdue" : daysLeft === 0 ? " · Today" : ` · ${daysLeft}d`)}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline" size="sm" className="shrink-0 h-7 text-xs"
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
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Service records */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <SectionHeader label="Service records" count={maintenance.length} />
                <Button size="sm" className="text-xs h-7" variant="outline" onClick={() => setShowMaintenanceDialog(true)}>
                  <Plus className="size-3.5 mr-1" /> Add
                </Button>
              </div>
              {maintenance.length === 0 ? (
                <EmptyState Icon={Wrench} message="No service records yet." />
              ) : (
                <div className="space-y-2">
                  {maintenance.map((m) => (
                    <Card key={m.id}>
                      <CardContent className="p-4 flex gap-3">
                        <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <Wrench className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between gap-2">
                            <p className="text-sm font-medium">{m.title}</p>
                            {m.cost_minor != null && m.currency && (
                              <p className="text-sm font-bold tabular-nums shrink-0">
                                {fmtAmount(Number(m.cost_minor), m.currency, masked)}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-2 mt-1 text-xs text-muted-foreground">
                            <span className="capitalize">{m.maintenance_category.replace("_", " ")}</span>
                            {m.serviced_at && <span>· {m.serviced_at}</span>}
                            {m.next_due_date && <span>· Next: {m.next_due_date}</span>}
                            {m.status === "overdue" && <span className="text-destructive font-medium">· Overdue</span>}
                          </div>
                        </div>
                        <button
                          disabled={isPending}
                          className="size-6 rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-all shrink-0"
                          onClick={() => {
                            if (confirm("Delete this record?")) {
                              startTransition(async () => {
                                const r = await deleteMaintenanceRecordAction(vehicleId, m.id);
                                if (r.ok) setMaintenance((prev) => prev.filter((x) => x.id !== m.id));
                              });
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Documents */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <SectionHeader label="Documents" count={documents.length} />
                <Button size="sm" className="text-xs h-7" variant="outline" onClick={() => setShowDocDialog(true)}>
                  <Plus className="size-3.5 mr-1" /> Add
                </Button>
              </div>
              {documents.length === 0 ? (
                <EmptyState Icon={FileText} message="No documents added yet." />
              ) : (
                <div className="space-y-2">
                  {documents.map((d) => {
                    const daysLeft = d.expiry_date ? daysUntil(d.expiry_date) : null;
                    const urgency = daysLeft === null ? "none" : daysLeft < 0 ? "expired" : daysLeft <= 7 ? "urgent" : daysLeft <= 30 ? "warning" : "ok";
                    return (
                      <Card key={d.id}>
                        <CardContent className="p-4 flex gap-3">
                          <div className={[
                            "size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                            urgency === "expired" || urgency === "urgent" ? "bg-destructive/10" : "bg-muted",
                          ].join(" ")}>
                            <FileText className={[
                              "size-3.5",
                              urgency === "expired" || urgency === "urgent" ? "text-destructive" : "text-muted-foreground",
                            ].join(" ")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between gap-2">
                              <p className="text-sm font-medium">{d.title}</p>
                              {d.expiry_date && (
                                <span className={[
                                  "text-xs font-semibold shrink-0",
                                  urgency === "expired" || urgency === "urgent" ? "text-destructive" : urgency === "warning" ? "text-amber-600" : "text-muted-foreground",
                                ].join(" ")}>
                                  {urgency === "expired" ? "Expired" : urgency === "urgent" ? `${daysLeft}d left` : urgency === "warning" ? `${daysLeft}d left` : "Valid"}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                              <span className="uppercase tracking-wide">{d.document_type.replace("_", " ")}</span>
                              {d.expiry_date && <span>· {d.expiry_date}</span>}
                            </div>
                          </div>
                          <button
                            disabled={isPending}
                            className="size-6 rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-all shrink-0"
                            onClick={() => {
                              if (confirm("Delete this document?")) {
                                startTransition(async () => {
                                  const r = await deleteVehicleDocumentAction(vehicleId, d.id);
                                  if (r.ok) setDocuments((prev) => prev.filter((x) => x.id !== d.id));
                                });
                              }
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analytics */}
        {activeTab === "analytics" && (
          <div className="space-y-4">

            {/* Monthly costs bar chart */}
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                  Monthly costs (fuel)
                </p>
                {chartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No monthly data yet.</p>
                ) : (
                  <>
                    <div className="flex items-end gap-1.5 h-28">
                      {chartData.map((m) => (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1 h-full">
                          <div className="flex-1 w-full flex flex-col justify-end">
                            <div
                              className="w-full bg-primary rounded-t-sm min-h-[3px] transition-all"
                              style={{ height: `${(m.totalCostMinor / maxBar) * 100}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground text-[10px] tabular-nums">
                            {m.month.slice(5)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {monthlyTrendStats && !masked && (
                      <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-4">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Last</p>
                          <p className="text-sm font-bold tabular-nums mt-0.5">
                            {fmtAmount(monthlyTrendStats.last, currency, false)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg</p>
                          <p className="text-sm font-bold tabular-nums mt-0.5">
                            {fmtAmount(monthlyTrendStats.avg, currency, false)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Change</p>
                          <p className={["text-sm font-bold tabular-nums mt-0.5", monthlyTrendStats.changePct < 0 ? "text-emerald-600" : "text-destructive"].join(" ")}>
                            {monthlyTrendStats.changePct >= 0 ? "+" : ""}{monthlyTrendStats.changePct.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Efficiency trend per fill-up */}
            {efficiencyTrend.length >= 2 && (
              <Card>
                <CardContent className="p-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                    Efficiency trend (km/L per fill-up)
                  </p>
                  <div className="flex items-end gap-1.5 h-24">
                    {efficiencyTrend.map((pt, i) => {
                      const maxKmL = Math.max(...efficiencyTrend.map((p) => p.kmPerL));
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full">
                          <div className="flex-1 w-full flex flex-col justify-end">
                            <div
                              className="w-full bg-primary/70 rounded-t-sm min-h-[3px] transition-all"
                              style={{ height: `${(pt.kmPerL / maxKmL) * 100}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground text-[9px] tabular-nums">{pt.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
                    <span>Min: {Math.min(...efficiencyTrend.map((p) => p.kmPerL)).toFixed(1)} km/L</span>
                    <span>Max: {Math.max(...efficiencyTrend.map((p) => p.kmPerL)).toFixed(1)} km/L</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Price per litre trend */}
            {priceTrend.length >= 2 && !masked && (
              <Card>
                <CardContent className="p-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                    Fuel price trend ({currency === "INR" ? "₹" : currency}/L)
                  </p>
                  <div className="flex items-end gap-1.5 h-24">
                    {priceTrend.map((pt, i) => {
                      const maxP = Math.max(...priceTrend.map((p) => p.pricePerL));
                      const minP = Math.min(...priceTrend.map((p) => p.pricePerL));
                      const range = maxP - minP || 1;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full">
                          <div className="flex-1 w-full flex flex-col justify-end">
                            <div
                              className="w-full bg-primary/50 rounded-t-sm min-h-[3px] transition-all"
                              style={{ height: `${20 + ((pt.pricePerL - minP) / range) * 80}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground text-[9px] tabular-nums">{pt.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
                    <span>Min: {currency === "INR" ? "₹" : currency}{Math.min(...priceTrend.map((p) => p.pricePerL)).toFixed(2)}/L</span>
                    <span>Max: {currency === "INR" ? "₹" : currency}{Math.max(...priceTrend.map((p) => p.pricePerL)).toFixed(2)}/L</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Fuel efficiency & distance */}
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                  Efficiency & distance
                </p>
                <div className="space-y-3">
                  <StatRow
                    label="Avg efficiency"
                    value={efficiency.type === "computed"
                      ? `${(efficiency.kmPerLitreCx100 / 100).toFixed(2)} km/L`
                      : simpleKmPerL != null ? `${simpleKmPerL.toFixed(2)} km/L` : "—"}
                  />
                  {totalDistanceKm != null && (
                    <>
                      <div className="h-px bg-border" />
                      <StatRow label="Total distance" value={`${totalDistanceKm.toFixed(0)} km`} />
                    </>
                  )}
                  {avgKmPerFillup != null && (
                    <>
                      <div className="h-px bg-border" />
                      <StatRow label="Avg distance per fill-up" value={`${avgKmPerFillup.toFixed(0)} km`} />
                    </>
                  )}
                  {costPerKm.type === "computed" && (
                    <>
                      <div className="h-px bg-border" />
                      <StatRow
                        label="Cost per km"
                        value={masked ? "***" : `${currency === "INR" ? "₹" : currency}${(costPerKm.costPerKmCx100 / 100).toFixed(2)}/km`}
                      />
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Fill-up stats */}
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                  Fill-up statistics
                </p>
                <div className="space-y-3">
                  <StatRow label="Total fill-ups" value={String(fuelEntries.length)} />
                  <div className="h-px bg-border" />
                  <StatRow label="Total litres" value={`${totalLitres.toFixed(2)} L`} />
                  {minFillupL != null && maxFillupL != null && (
                    <>
                      <div className="h-px bg-border" />
                      <StatRow label="Smallest fill-up" value={`${minFillupL.toFixed(2)} L`} />
                      <StatRow label="Largest fill-up" value={`${maxFillupL.toFixed(2)} L`} />
                    </>
                  )}
                  {!masked && bestFuelPricePerL != null && (
                    <>
                      <div className="h-px bg-border" />
                      <StatRow label="Best fuel price" value={`${currency === "INR" ? "₹" : currency}${bestFuelPricePerL.toFixed(2)}/L`} />
                      {worstFuelPricePerL != null && (
                        <StatRow label="Worst fuel price" value={`${currency === "INR" ? "₹" : currency}${worstFuelPricePerL.toFixed(2)}/L`} />
                      )}
                      {lastFuelPricePerL != null && (
                        <StatRow label="Last fuel price" value={`${currency === "INR" ? "₹" : currency}${lastFuelPricePerL.toFixed(2)}/L`} />
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Cost breakdown */}
            <Card>
              <CardContent className="p-5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                  Cost breakdown
                </p>
                <div className="space-y-3">
                  {thisYearFuelCostMinor > 0 && (
                    <>
                      <StatRow label={`This year (${thisYear})`} value={fmtAmount(thisYearFuelCostMinor, currency, masked)} />
                      <div className="h-px bg-border" />
                    </>
                  )}
                  <StatRow label="All-time fuel" value={fmtAmount(dashboard.totalFuelCostMinor, currency, masked)} />
                  <div className="h-px bg-border" />
                  <StatRow label="Other expenses" value={fmtAmount(dashboard.totalOtherCostMinor, currency, masked)} />
                  <div className="h-px bg-border" />
                  <div className="flex justify-between items-baseline text-sm">
                    <span className="font-semibold">Total</span>
                    <span className="font-bold tabular-nums">{fmtAmount(dashboard.totalCostMinor, currency, masked)}</span>
                  </div>
                  {avgCostPerMonth != null && !masked && (
                    <>
                      <div className="h-px bg-border" />
                      <StatRow label="Avg cost per month" value={fmtAmount(avgCostPerMonth, currency, false)} />
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── Dialogs ── */}

      <Dialog open={showFuelDialog} onOpenChange={(open) => { setShowFuelDialog(open); if (!open) resetFuelForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingFuelId ? "Edit fuel entry" : "Log fuel entry"}</DialogTitle></DialogHeader>
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
            <Button variant="outline" onClick={() => { setShowFuelDialog(false); resetFuelForm(); }}>Cancel</Button>
            <Button onClick={handleAddFuel} disabled={isPending}>{isPending ? "Saving..." : editingFuelId ? "Save changes" : "Log entry"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showExpenseDialog} onOpenChange={(open) => { setShowExpenseDialog(open); if (!open) resetExpenseForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add vehicle expense</DialogTitle></DialogHeader>
          <div className="space-y-4">

            {/* Linked transaction chip */}
            {linkedTxn ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                <Link2 className="size-3.5 text-primary shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-foreground truncate block">
                    {linkedTxn.item_name ?? linkedTxn.merchant ?? "Transaction"}
                  </span>
                  <span className="text-xs text-muted-foreground">Linked transaction</span>
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setLinkedTxn(null)}
                  title="Remove link"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-muted-foreground border-dashed"
                onClick={() => setShowLinkTxnDialog(true)}
              >
                <Link2 className="size-3.5 mr-1.5" />
                Link to existing transaction
              </Button>
            )}

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
            <Button variant="outline" onClick={() => { setShowExpenseDialog(false); resetExpenseForm(); }}>Cancel</Button>
            <Button onClick={handleAddExpense} disabled={isPending}>{isPending ? "Saving..." : "Add expense"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LinkTransactionDialog
        open={showLinkTxnDialog}
        onOpenChange={setShowLinkTxnDialog}
        onSelect={handleLinkTxn}
      />

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
            <Button onClick={handleAddMaintenance} disabled={isPending}>{isPending ? "Saving..." : "Add record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <Button onClick={handleAddDocument} disabled={isPending}>{isPending ? "Saving..." : "Add document"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, Icon }: { label: string; value: string; Icon: React.ElementType }) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <Icon className="size-4 text-primary mb-2" />
        <p className="text-base font-bold tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

function MonthCostCol({
  label, fuelCost, otherCost, litresMl, currency, masked, highlight = false,
}: {
  label: string; fuelCost: number; otherCost: number; litresMl: number; currency: string; masked: boolean; highlight?: boolean;
}) {
  const litres = litresMl / 1000;
  return (
    <div className={["rounded-lg p-3", highlight ? "bg-primary/5" : "bg-muted/40"].join(" ")}>
      <p className={["text-[10px] font-semibold uppercase tracking-widest mb-2", highlight ? "text-primary" : "text-muted-foreground"].join(" ")}>
        {label}
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Fuel className="size-3 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold tabular-nums">{fmtAmount(fuelCost, currency, masked)}</span>
          <span className="text-xs text-muted-foreground">Fuel</span>
        </div>
        {litres > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="size-3 shrink-0" />
            <span className="text-xs text-muted-foreground tabular-nums">{litres.toFixed(1)} L</span>
          </div>
        )}
        {otherCost > 0 && (
          <div className="flex items-center gap-1.5">
            <DollarSign className="size-3 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium tabular-nums text-muted-foreground">{fmtAmount(otherCost, currency, masked)}</span>
            <span className="text-xs text-muted-foreground">Other</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{label}</p>
      {count > 0 && (
        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full tabular-nums">{count}</span>
      )}
    </div>
  );
}

function MonthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold text-primary uppercase tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}

function EmptyState({ Icon, message }: { Icon: React.ElementType; message: string }) {
  return (
    <div className="border border-dashed rounded-xl flex flex-col items-center gap-3 py-12 px-6 text-center">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
    </div>
  );
}
