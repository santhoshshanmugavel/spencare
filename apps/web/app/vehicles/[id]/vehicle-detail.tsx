"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Fuel, Wrench, FileText, Bell, DollarSign, BarChart3,
  Plus, Trash2, Gauge, Pencil, Link2, X, Droplets, Navigation, Camera,
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
import { updateVehiclePhotoAction, removeVehiclePhotoAction } from "./actions";
import { LinkTransactionDialog } from "../link-transaction-dialog";
import { toastConfirmed, toastError } from "@/lib/toast";

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

// ── Vehicle photo uploader — full-width card, same pattern as GoalImageUploader ─

function VehiclePhotoUploader({
  vehicleId,
  vehicleName,
  vehicleSubtitle,
  initialUrl,
}: {
  vehicleId: string;
  vehicleName: string;
  vehicleSubtitle: string | null;
  initialUrl: string | null;
}) {
  const [photoUrl, setPhotoUrl] = useState(initialUrl);
  const [isUploading, startUpload] = useTransition();
  const [isRemoving, startRemove] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const isPending = isUploading || isRemoving;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("image", file);
    startUpload(async () => {
      const result = await updateVehiclePhotoAction(vehicleId, formData);
      if (result.ok) {
        setPhotoUrl(result.value.signedUrl);
        toastConfirmed("Photo updated.");
      } else {
        toastError(result.error.message);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    startRemove(async () => {
      const result = await removeVehiclePhotoAction(vehicleId);
      if (result.ok) {
        setPhotoUrl(null);
        toastConfirmed("Photo removed.");
      } else {
        toastError(result.error.message);
      }
    });
  }

  return (
    <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-primary/10 flex items-center justify-center">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={vehicleName} className="size-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-1 px-6 text-center select-none">
          <p className="text-xl font-bold text-primary leading-tight">{vehicleName}</p>
          {vehicleSubtitle && (
            <p className="text-sm text-primary/60 font-medium">{vehicleSubtitle}</p>
          )}
        </div>
      )}

      {isPending ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-2.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg bg-background/85 backdrop-blur-sm border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background transition-colors shadow-sm"
            aria-label={photoUrl ? `Replace ${vehicleName} photo` : `Add photo for ${vehicleName}`}
          >
            <Camera className="size-3.5" />
            {photoUrl ? "Replace" : "Add photo"}
          </button>
          {photoUrl && (
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-1.5 rounded-lg bg-background/85 backdrop-blur-sm border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background transition-colors shadow-sm"
              aria-label={`Remove ${vehicleName} photo`}
            >
              <X className="size-3.5" />
              Remove
            </button>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label={`Upload photo for ${vehicleName}`}
        onChange={handleFileChange}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Props ───────────────────────────────────────────────────────────────────

interface VehicleDetailProps {
  dashboard: VehicleDashboardData;
  maintenanceRecords: VehicleMaintenanceRow[];
  documents: VehicleDocumentRow[];
  reminders: VehicleReminderRow[];
  masked: boolean;
  vehiclePhotoUrl: string | null;
}

// ── Main component ─────────────────────────────────────────────────────────

export function VehicleDetail({
  dashboard,
  maintenanceRecords: initialMaintenance,
  documents: initialDocuments,
  reminders: initialReminders,
  masked,
  vehiclePhotoUrl,
}: VehicleDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<TabId>("fuel");

  const [fuelEntries, setFuelEntries] = useState(dashboard.fuelEntries);
  const [expenses, setExpenses] = useState(dashboard.expenses);
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [documents, setDocuments] = useState(initialDocuments);
  const [reminders, setReminders] = useState(initialReminders);

  type StatsSubTab = "fillups" | "costs" | "distance";
  const [statsSubTab, setStatsSubTab] = useState<StatsSubTab>("fillups");
  const [chartFilter, setChartFilter] = useState<"all" | "ytd" | "prev_year" | "this_month">("ytd");

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

  // ── Extended period breakdown metrics ────────────────────────────────────

  const prevYear = useMemo(() => (Number(thisYear) - 1).toString(), [thisYear]);
  const prevYearMonths = useMemo(
    () => dashboard.monthlyCosts.filter((m) => m.month.startsWith(prevYear)),
    [dashboard.monthlyCosts, prevYear]
  );

  // Fill-up lists per period
  const thisYearFillupsList = useMemo(
    () => fuelEntries.filter((e) => e.occurred_at.startsWith(thisYear)),
    [fuelEntries, thisYear]
  );
  const thisMonthFillupsList = useMemo(
    () => fuelEntries.filter((e) => e.occurred_at.startsWith(currentYearMonth())),
    [fuelEntries]
  );
  const prevYearFillupsList = useMemo(
    () => fuelEntries.filter((e) => e.occurred_at.startsWith(prevYear)),
    [fuelEntries, prevYear]
  );
  const prevMonthFillupsList = useMemo(
    () => fuelEntries.filter((e) => e.occurred_at.startsWith(prevYearMonth())),
    [fuelEntries]
  );

  // Litres per period
  const thisYearLitresL = useMemo(
    () => thisYearFillupsList.reduce((a, e) => a + Number(e.fuel_quantity_ml), 0) / 1000,
    [thisYearFillupsList]
  );
  const thisMonthLitresL = useMemo(
    () => thisMonthFillupsList.reduce((a, e) => a + Number(e.fuel_quantity_ml), 0) / 1000,
    [thisMonthFillupsList]
  );
  const prevYearLitresL = useMemo(
    () => prevYearFillupsList.reduce((a, e) => a + Number(e.fuel_quantity_ml), 0) / 1000,
    [prevYearFillupsList]
  );
  const prevMonthLitresL = useMemo(
    () => prevMonthFillupsList.reduce((a, e) => a + Number(e.fuel_quantity_ml), 0) / 1000,
    [prevMonthFillupsList]
  );

  // Costs per period
  const prevYearCostMinor = useMemo(
    () => prevYearMonths.reduce((a, m) => a + m.totalCostMinor, 0),
    [prevYearMonths]
  );
  const prevMonthCostMinor = prevMonthCosts?.totalCostMinor ?? 0;

  // Distance deltas per period
  const thisYearDistKm = useMemo(
    () => thisYearFillupsList.reduce((a, e) => a + (distanceDeltaMap.get(e.id) ?? 0), 0),
    [thisYearFillupsList, distanceDeltaMap]
  );
  const thisMonthDistKm = useMemo(
    () => thisMonthFillupsList.reduce((a, e) => a + (distanceDeltaMap.get(e.id) ?? 0), 0),
    [thisMonthFillupsList, distanceDeltaMap]
  );
  const prevYearDistKm = useMemo(
    () => prevYearFillupsList.reduce((a, e) => a + (distanceDeltaMap.get(e.id) ?? 0), 0),
    [prevYearFillupsList, distanceDeltaMap]
  );
  const prevMonthDistKm = useMemo(
    () => prevMonthFillupsList.reduce((a, e) => a + (distanceDeltaMap.get(e.id) ?? 0), 0),
    [prevMonthFillupsList, distanceDeltaMap]
  );

  // Individual bill costs
  const billCosts = useMemo(
    () => fuelEntries.filter((e) => e.total_cost_minor != null).map((e) => Number(e.total_cost_minor!)),
    [fuelEntries]
  );
  const lowestBill = useMemo(() => billCosts.length > 0 ? Math.min(...billCosts) : null, [billCosts]);
  const highestBill = useMemo(() => billCosts.length > 1 ? Math.max(...billCosts) : null, [billCosts]);

  // Average cost per day
  const avgCostPerDay = useMemo(() => {
    if (fuelEntries.length < 2 || dashboard.totalCostMinor <= 0) return null;
    const dates = fuelEntries.map((e) => new Date(e.occurred_at).getTime());
    const days = (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
    return days > 0 ? dashboard.totalCostMinor / days : null;
  }, [fuelEntries, dashboard.totalCostMinor]);

  // Average km per day and per month
  const avgKmPerDay = useMemo(() => {
    if (!totalDistanceKm || fuelEntries.length < 2) return null;
    const dates = fuelEntries.map((e) => new Date(e.occurred_at).getTime());
    const days = (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
    return days > 0 ? totalDistanceKm / days : null;
  }, [totalDistanceKm, fuelEntries]);

  const avgKmPerMonth = useMemo(() => {
    if (!totalDistanceKm || !dashboard.monthlyCosts.length) return null;
    return totalDistanceKm / dashboard.monthlyCosts.length;
  }, [totalDistanceKm, dashboard.monthlyCosts]);

  // Last odometer reading
  const lastOdometerKm = useMemo(
    () => fuelEntries.length > 0 ? Number(fuelEntries[0].odometer) / 10 : null,
    [fuelEntries]
  );

  // Cost per km per individual fill-up (best/worst)
  const fillupCostPerKm = useMemo(() => {
    const ascending = [...fuelEntries].reverse();
    const vals: number[] = [];
    for (let i = 1; i < ascending.length; i++) {
      const curr = ascending[i];
      const prev = ascending[i - 1];
      const distKm = (Number(curr.odometer) - Number(prev.odometer)) / 10;
      if (distKm > 0 && curr.total_cost_minor != null) {
        vals.push(Number(curr.total_cost_minor) / distKm);
      }
    }
    return vals;
  }, [fuelEntries]);
  const bestCostPerKm = fillupCostPerKm.length > 0 ? Math.min(...fillupCostPerKm) : null;
  const worstCostPerKm = fillupCostPerKm.length > 1 ? Math.max(...fillupCostPerKm) : null;

  // Average days between fill-ups
  const avgDaysBetweenFillups = useMemo(() => {
    if (fuelEntries.length < 2) return null;
    const dates = fuelEntries.map((e) => new Date(e.occurred_at).getTime());
    const totalDays = (Math.max(...dates) - Math.min(...dates)) / 86_400_000;
    return totalDays / (fuelEntries.length - 1);
  }, [fuelEntries]);

  // YTD total spend (fuel + other)
  const thisYearTotalMinor = useMemo(
    () => thisYearMonths.reduce((a, m) => a + m.totalCostMinor, 0),
    [thisYearMonths]
  );

  // Best and worst spending months (all-time)
  const bestCostMonth = useMemo(() => {
    const months = dashboard.monthlyCosts.filter((m) => m.totalCostMinor > 0);
    if (!months.length) return null;
    return months.reduce((min, m) => m.totalCostMinor < min.totalCostMinor ? m : min);
  }, [dashboard.monthlyCosts]);

  const worstCostMonth = useMemo(() => {
    const months = dashboard.monthlyCosts.filter((m) => m.totalCostMinor > 0);
    if (months.length < 2) return null;
    return months.reduce((max, m) => m.totalCostMinor > max.totalCostMinor ? m : max);
  }, [dashboard.monthlyCosts]);

  // Monthly distance data for bar chart (last 7 months)
  const monthlyDistanceData = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of fuelEntries) {
      const month = e.occurred_at.slice(0, 7);
      const delta = distanceDeltaMap.get(e.id) ?? 0;
      map.set(month, (map.get(month) ?? 0) + delta);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([month, km]) => ({ month, km }));
  }, [fuelEntries, distanceDeltaMap]);

  // Chart data filtered by period selector
  const filteredChartData = useMemo(() => {
    const sorted = [...dashboard.monthlyCosts].reverse();
    switch (chartFilter) {
      case "ytd": return sorted.filter((m) => m.month.startsWith(thisYear));
      case "prev_year": return sorted.filter((m) => m.month.startsWith(prevYear));
      case "this_month": return sorted.filter((m) => m.month === currentYearMonth());
      default: return sorted;
    }
  }, [dashboard.monthlyCosts, chartFilter, thisYear, prevYear]);

  const filteredMaxBar = useMemo(
    () => Math.max(...filteredChartData.map((m) => m.totalCostMinor), 1),
    [filteredChartData]
  );

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
          {(dashboard.vehicle.make || dashboard.vehicle.model) && (
            <p className="text-sm text-muted-foreground leading-tight mt-0.5">
              {[dashboard.vehicle.make, dashboard.vehicle.model, dashboard.vehicle.manufacturing_year].filter(Boolean).join(" ")}
            </p>
          )}
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

      {/* ── Vehicle photo — full-width, any aspect uploaded, shown 3:2 ── */}
      <VehiclePhotoUploader
        vehicleId={dashboard.vehicle.id}
        vehicleName={dashboard.vehicle.name}
        vehicleSubtitle={[dashboard.vehicle.make, dashboard.vehicle.model].filter(Boolean).join(" ") || null}
        initialUrl={vehiclePhotoUrl}
      />

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

          <div className="mt-4 pt-4 border-t border-primary/10 grid grid-cols-3 gap-3">
            <div>
              <p className="text-sm font-bold tabular-nums">
                {totalDistanceKm != null ? `${totalDistanceKm.toFixed(0)} km` : "—"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Tracked</p>
            </div>
            <div>
              <p className="text-sm font-bold tabular-nums">{fuelEntries.length}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Fill-ups</p>
            </div>
            <div>
              <p className="text-sm font-bold tabular-nums">{fmtAmount(dashboard.totalCostMinor, currency, masked)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Total spent</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Secondary stats 2×2 ── */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Cost per km"
          value={costPerKm.type === "computed"
            ? `${currency === "INR" ? "₹" : currency}${(costPerKm.costPerKmCx100 / 10000).toFixed(2)}/km`
            : "—"}
          Icon={Gauge}
        />
        <StatCard
          label="Last fuel price"
          value={lastFuelPricePerL != null && !masked
            ? `${currency === "INR" ? "₹" : currency}${lastFuelPricePerL.toFixed(2)}/L`
            : "—"}
          Icon={Fuel}
          sub={!masked && fuelPricesPerL.length > 1
            ? `prev ${currency === "INR" ? "₹" : currency}${fuelPricesPerL[1].toFixed(2)}/L`
            : undefined}
        />
        <StatCard
          label="Fill-ups"
          value={String(fuelEntries.length)}
          Icon={BarChart3}
          sub={thisMonthFillupsList.length > 0 ? `${thisMonthFillupsList.length} this month` : undefined}
        />
        <StatCard
          label="Total spend"
          value={fmtAmount(dashboard.totalCostMinor, currency, masked)}
          Icon={DollarSign}
          sub={thisMonthCosts && !masked ? `${fmtAmount(thisMonthCosts.totalCostMinor, currency, false)} this mo` : undefined}
        />
      </div>

      {/* ── This month vs Previous month ── */}
      {(thisMonthCosts || prevMonthCosts) && (() => {
        const currTotal = thisMonthCosts?.totalCostMinor ?? 0;
        const prevTotal = prevMonthCosts?.totalCostMinor ?? 0;
        const changePct = prevTotal > 0 ? ((currTotal - prevTotal) / prevTotal) * 100 : null;
        const currL = (thisMonthCosts?.fuelLitresMl ?? 0) / 1000;
        const prevL = (prevMonthCosts?.fuelLitresMl ?? 0) / 1000;
        const currPricePerL = currL > 0 && (thisMonthCosts?.fuelCostMinor ?? 0) > 0
          ? (thisMonthCosts!.fuelCostMinor / 100) / currL : null;
        const prevPricePerL = prevL > 0 && (prevMonthCosts?.fuelCostMinor ?? 0) > 0
          ? (prevMonthCosts!.fuelCostMinor / 100) / prevL : null;
        const sym = currency === "INR" ? "₹" : currency;
        return (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Monthly costs</p>
                {changePct !== null && !masked && (
                  <span className={[
                    "text-xs font-bold px-2 py-0.5 rounded-full",
                    changePct < 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive",
                  ].join(" ")}>
                    {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}% vs last month
                  </span>
                )}
              </div>

              {/* This month */}
              <div className="rounded-lg bg-primary/5 border border-primary/10 p-3.5 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-primary uppercase tracking-widest">
                    {formatMonthLabel(currentYearMonth())}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {thisMonthFillupsList.length} fill-up{thisMonthFillupsList.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-2xl font-bold tabular-nums">{fmtAmount(currTotal, currency, masked)}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                  {(thisMonthCosts?.fuelCostMinor ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <Fuel className="size-3 shrink-0" />
                      {fmtAmount(thisMonthCosts!.fuelCostMinor, currency, masked)} fuel
                    </span>
                  )}
                  {currL > 0 && <span className="tabular-nums">{currL.toFixed(1)} L</span>}
                  {currPricePerL != null && !masked && (
                    <span className="tabular-nums font-medium">{sym}{currPricePerL.toFixed(2)}/L</span>
                  )}
                  {(thisMonthCosts?.otherCostMinor ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <DollarSign className="size-3 shrink-0" />
                      {fmtAmount(thisMonthCosts!.otherCostMinor, currency, masked)} other
                    </span>
                  )}
                </div>
              </div>

              {/* Last month */}
              {prevMonthCosts && (
                <div className="rounded-lg bg-muted/30 p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                      {formatMonthLabel(prevYearMonth())}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {prevMonthFillupsList.length} fill-up{prevMonthFillupsList.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-muted-foreground">{fmtAmount(prevTotal, currency, masked)}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                    {prevMonthCosts.fuelCostMinor > 0 && (
                      <span className="flex items-center gap-1">
                        <Fuel className="size-3 shrink-0" />
                        {fmtAmount(prevMonthCosts.fuelCostMinor, currency, masked)} fuel
                      </span>
                    )}
                    {prevL > 0 && <span className="tabular-nums">{prevL.toFixed(1)} L</span>}
                    {prevPricePerL != null && !masked && (
                      <span className="tabular-nums">{sym}{prevPricePerL.toFixed(2)}/L</span>
                    )}
                    {prevMonthCosts.otherCostMinor > 0 && (
                      <span>{fmtAmount(prevMonthCosts.otherCostMinor, currency, masked)} other</span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ── YTD quick-stats band ── */}
      {(thisYearTotalMinor > 0 || thisYearFillupsList.length > 0) && (
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="flex gap-2.5 min-w-max pb-0.5">
            <YtdPill
              label={new Date().getFullYear() + " spend"}
              value={fmtAmount(thisYearTotalMinor, currency, masked)}
              accent
            />
            {thisYearLitresL > 0 && (
              <YtdPill label="Litres" value={`${thisYearLitresL.toFixed(1)} L`} />
            )}
            {thisYearDistKm > 0 && (
              <YtdPill label="Distance" value={`${thisYearDistKm.toFixed(0)} km`} />
            )}
            {thisYearFillupsList.length > 0 && (
              <YtdPill label="Fill-ups" value={String(thisYearFillupsList.length)} />
            )}
            {avgDaysBetweenFillups != null && (
              <YtdPill label="Every" value={`${avgDaysBetweenFillups.toFixed(0)} days`} />
            )}
          </div>
        </div>
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
                {id === "fuel" && fuelEntries.length > 0 && (
                  <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-px tabular-nums font-medium leading-none">
                    {fuelEntries.length}
                  </span>
                )}
                {id === "expenses" && expenses.length > 0 && (
                  <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-px tabular-nums font-medium leading-none">
                    {expenses.length}
                  </span>
                )}
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
                              {e.fuel_type && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold capitalize tracking-wide">
                                  {e.fuel_type}
                                </span>
                              )}
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
                              {e.station_name && (
                                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                                  {e.station_name}
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

        {/* Analytics — 3 sub-tabs */}
        {activeTab === "analytics" && (
          <div className="space-y-4">

            {/* Sub-tab selector */}
            <div className="flex gap-1 bg-muted p-1 rounded-lg">
              {([ ["fillups", "Fill-ups"], ["costs", "Costs"], ["distance", "Distance"] ] as [StatsSubTab, string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setStatsSubTab(id)}
                  className={[
                    "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                    statsSubTab === id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── Fill-ups sub-tab ── */}
            {statsSubTab === "fillups" && (
              <div className="space-y-4">

                {/* Total fill-ups 4-cell */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Fuel className="size-3.5 text-primary" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Total fill-ups</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <PeriodCell label="This year" value={String(thisYearFillupsList.length)} highlight />
                      <PeriodCell label="This month" value={String(thisMonthFillupsList.length)} />
                      <PeriodCell label="Prev year" value={String(prevYearFillupsList.length)} />
                      <PeriodCell label="Prev month" value={String(prevMonthFillupsList.length)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Total litres 4-cell */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Droplets className="size-3.5 text-primary" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Total litres</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <PeriodCell label="This year" value={`${thisYearLitresL.toFixed(1)} L`} highlight />
                      <PeriodCell label="This month" value={`${thisMonthLitresL.toFixed(1)} L`} />
                      <PeriodCell label="Prev year" value={`${prevYearLitresL.toFixed(1)} L`} />
                      <PeriodCell label="Prev month" value={`${prevMonthLitresL.toFixed(1)} L`} />
                    </div>
                  </CardContent>
                </Card>

                {/* Efficiency stats */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <StatRow
                      label="Avg consumption"
                      value={efficiency.type === "computed"
                        ? `${(efficiency.kmPerLitreCx100 / 100).toFixed(2)} km/L`
                        : simpleKmPerL != null ? `${simpleKmPerL.toFixed(2)} km/L` : "—"}
                    />
                    {efficiencyTrend.length >= 2 && (
                      <>
                        <div className="h-px bg-border" />
                        <StatRow
                          label="Best fill-up"
                          value={`${Math.max(...efficiencyTrend.map((p) => p.kmPerL)).toFixed(1)} km/L`}
                          accent="emerald"
                        />
                        <div className="h-px bg-border" />
                        <StatRow
                          label="Worst fill-up"
                          value={`${Math.min(...efficiencyTrend.map((p) => p.kmPerL)).toFixed(1)} km/L`}
                          accent="destructive"
                        />
                      </>
                    )}
                    {minFillupL != null && (
                      <>
                        <div className="h-px bg-border" />
                        <StatRow label="Min fill-up" value={`${minFillupL.toFixed(2)} L`} />
                      </>
                    )}
                    {maxFillupL != null && (
                      <>
                        <div className="h-px bg-border" />
                        <StatRow label="Max fill-up" value={`${maxFillupL.toFixed(2)} L`} />
                      </>
                    )}
                    {avgKmPerFillup != null && (
                      <>
                        <div className="h-px bg-border" />
                        <StatRow label="Avg km per fill-up" value={`${avgKmPerFillup.toFixed(0)} km`} />
                      </>
                    )}
                    {avgDaysBetweenFillups != null && (
                      <>
                        <div className="h-px bg-border" />
                        <StatRow label="Avg days between fill-ups" value={`${avgDaysBetweenFillups.toFixed(0)} days`} />
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Efficiency trend chart */}
                {efficiencyTrend.length >= 2 && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Efficiency trend</p>
                      <div className="flex items-end gap-1.5 h-24">
                        {efficiencyTrend.map((pt, i) => {
                          const maxKmL = Math.max(...efficiencyTrend.map((p) => p.kmPerL));
                          const pct = (pt.kmPerL / maxKmL) * 100;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center h-full">
                              <div className="flex-1 w-full flex flex-col justify-end">
                                <span className="text-[8px] text-primary font-semibold text-center tabular-nums mb-0.5 block">{pt.kmPerL.toFixed(1)}</span>
                                <div className="w-full bg-primary/70 rounded-t-sm min-h-[3px]" style={{ height: `${pct}%` }} />
                              </div>
                              <span className="text-muted-foreground text-[9px] tabular-nums mt-1">{pt.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">km/L per fill-up</p>
                    </CardContent>
                  </Card>
                )}

                {/* Fuel price trend chart */}
                {priceTrend.length >= 2 && !masked && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Fuel price trend</p>
                      <div className="flex items-end gap-1.5 h-24">
                        {(() => {
                          const maxP = Math.max(...priceTrend.map((p) => p.pricePerL));
                          const minP = Math.min(...priceTrend.map((p) => p.pricePerL));
                          const range = maxP - minP || 1;
                          return priceTrend.map((pt, i) => {
                            const pct = ((pt.pricePerL - minP) / range) * 80 + 20;
                            const sym = currency === "INR" ? "₹" : currency;
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center h-full">
                                <div className="flex-1 w-full flex flex-col justify-end">
                                  <span className="text-[8px] text-emerald-600 font-semibold text-center tabular-nums mb-0.5 block leading-none">
                                    {sym}{pt.pricePerL.toFixed(0)}
                                  </span>
                                  <div className="w-full bg-emerald-500/70 rounded-t-sm min-h-[3px]" style={{ height: `${pct}%` }} />
                                </div>
                                <span className="text-muted-foreground text-[9px] tabular-nums mt-1">{pt.label}</span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">Price per litre (last {priceTrend.length} fill-ups)</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ── Costs sub-tab ── */}
            {statsSubTab === "costs" && (
              <div className="space-y-4">

                {/* Total costs 4-cell */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <DollarSign className="size-3.5 text-primary" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Total costs</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <PeriodCell label="This year" value={fmtAmount(thisYearTotalMinor, currency, masked)} highlight />
                      <PeriodCell label="This month" value={fmtAmount(thisMonthCosts?.totalCostMinor ?? 0, currency, masked)} />
                      <PeriodCell label="Prev year" value={fmtAmount(prevYearCostMinor, currency, masked)} />
                      <PeriodCell label="Prev month" value={fmtAmount(prevMonthCostMinor, currency, masked)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Cost stats */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    {!masked && avgCostPerMonth != null && (
                      <>
                        <StatRow label="Avg per month" value={fmtAmount(avgCostPerMonth, currency, false)} />
                        <div className="h-px bg-border" />
                      </>
                    )}
                    {!masked && avgCostPerDay != null && (
                      <>
                        <StatRow label="Avg per day" value={fmtAmount(avgCostPerDay, currency, false)} />
                        <div className="h-px bg-border" />
                      </>
                    )}
                    {costPerKm.type === "computed" && !masked && (
                      <>
                        <StatRow label="Avg cost per km" value={`${currency === "INR" ? "₹" : currency}${(costPerKm.costPerKmCx100 / 10000).toFixed(2)}/km`} />
                        {bestCostPerKm != null && (
                          <>
                            <div className="h-px bg-border" />
                            <StatRow label="Best cost per km" value={`${currency === "INR" ? "₹" : currency}${(bestCostPerKm / 100).toFixed(2)}/km`} accent="emerald" />
                          </>
                        )}
                        {worstCostPerKm != null && (
                          <>
                            <div className="h-px bg-border" />
                            <StatRow label="Worst cost per km" value={`${currency === "INR" ? "₹" : currency}${(worstCostPerKm / 100).toFixed(2)}/km`} accent="destructive" />
                          </>
                        )}
                        <div className="h-px bg-border" />
                      </>
                    )}
                    <StatRow label="All-time fuel cost" value={fmtAmount(dashboard.totalFuelCostMinor, currency, masked)} />
                    {dashboard.totalOtherCostMinor > 0 && (
                      <>
                        <div className="h-px bg-border" />
                        <StatRow label="Other expenses" value={fmtAmount(dashboard.totalOtherCostMinor, currency, masked)} />
                      </>
                    )}
                    <div className="h-px bg-border" />
                    <div className="flex justify-between items-baseline text-sm">
                      <span className="font-semibold">Total spent</span>
                      <span className="font-bold tabular-nums">{fmtAmount(dashboard.totalCostMinor, currency, masked)}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Bill stats */}
                {!masked && (lowestBill != null || highestBill != null || bestFuelPricePerL != null) && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      {lowestBill != null && (
                        <StatRow label="Lowest bill" value={fmtAmount(lowestBill, currency, false)} accent="emerald" />
                      )}
                      {highestBill != null && (
                        <>
                          <div className="h-px bg-border" />
                          <StatRow label="Highest bill" value={fmtAmount(highestBill, currency, false)} accent="destructive" />
                        </>
                      )}
                      {bestFuelPricePerL != null && (
                        <>
                          <div className="h-px bg-border" />
                          <StatRow label="Best fuel price" value={`${currency === "INR" ? "₹" : currency}${bestFuelPricePerL.toFixed(2)}/L`} accent="emerald" />
                        </>
                      )}
                      {worstFuelPricePerL != null && (
                        <>
                          <div className="h-px bg-border" />
                          <StatRow label="Worst fuel price" value={`${currency === "INR" ? "₹" : currency}${worstFuelPricePerL.toFixed(2)}/L`} accent="destructive" />
                        </>
                      )}
                      {bestCostMonth != null && (
                        <>
                          <div className="h-px bg-border" />
                          <StatRow
                            label={`Best month (${formatMonthLabel(bestCostMonth.month).split(" ").slice(0, 1).join("")} '${bestCostMonth.month.slice(2, 4)})`}
                            value={fmtAmount(bestCostMonth.totalCostMinor, currency, false)}
                            accent="emerald"
                          />
                        </>
                      )}
                      {worstCostMonth != null && (
                        <>
                          <div className="h-px bg-border" />
                          <StatRow
                            label={`Worst month (${formatMonthLabel(worstCostMonth.month).split(" ").slice(0, 1).join("")} '${worstCostMonth.month.slice(2, 4)})`}
                            value={fmtAmount(worstCostMonth.totalCostMinor, currency, false)}
                            accent="destructive"
                          />
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Costs bar chart with filter */}
                {filteredChartData.length > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Monthly costs</p>
                        <ChartFilterPills value={chartFilter} onChange={setChartFilter} />
                      </div>
                      <div className="flex items-end gap-1.5 h-28">
                        {filteredChartData.map((m) => {
                          const pct = (m.totalCostMinor / filteredMaxBar) * 100;
                          return (
                            <div key={m.month} className="flex-1 flex flex-col items-center h-full">
                              <div className="flex-1 w-full flex flex-col justify-end">
                                {!masked && <span className="text-[8px] text-primary font-semibold text-center tabular-nums mb-0.5 block leading-none">{fmtAmount(m.totalCostMinor, currency, false)}</span>}
                                <div className="w-full bg-primary rounded-t-sm min-h-[3px]" style={{ height: `${pct}%` }} />
                              </div>
                              <span className="text-muted-foreground text-[9px] tabular-nums mt-1">{m.month.slice(5)}</span>
                            </div>
                          );
                        })}
                      </div>
                      {/* Data table */}
                      <div className="mt-4 border-t pt-3 space-y-1">
                        <div className="grid grid-cols-3 text-[10px] text-muted-foreground font-semibold uppercase tracking-wide px-1 mb-1">
                          <span>Month</span>
                          <span className="text-right">Litres</span>
                          <span className="text-right">Cost</span>
                        </div>
                        {filteredChartData.map((m) => (
                          <div key={m.month} className="grid grid-cols-3 text-xs px-1 py-0.5 rounded hover:bg-muted/40">
                            <span className="text-muted-foreground">{formatMonthLabel(m.month).slice(0, 8)}</span>
                            <span className="text-right tabular-nums">{(m.fuelLitresMl / 1000).toFixed(1)} L</span>
                            <span className="text-right tabular-nums font-medium">{fmtAmount(m.totalCostMinor, currency, masked)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* ── Distance sub-tab ── */}
            {statsSubTab === "distance" && (
              <div className="space-y-4">

                {/* Hero: total distance + last odometer */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Navigation className="size-3.5 text-primary" />
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Distance</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-2xl font-bold tabular-nums">
                          {totalDistanceKm != null ? `${totalDistanceKm.toFixed(0)} km` : "—"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">Distance tracked</p>
                      </div>
                      {lastOdometerKm != null && (
                        <div>
                          <p className="text-2xl font-bold tabular-nums">{lastOdometerKm.toFixed(1)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Last odometer (km)</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Distance 4-cell */}
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">km driven</p>
                    <div className="grid grid-cols-2 gap-2">
                      <PeriodCell label="This year" value={`${thisYearDistKm.toFixed(0)} km`} highlight />
                      <PeriodCell label="This month" value={`${thisMonthDistKm.toFixed(0)} km`} />
                      <PeriodCell label="Prev year" value={`${prevYearDistKm.toFixed(0)} km`} />
                      <PeriodCell label="Prev month" value={`${prevMonthDistKm.toFixed(0)} km`} />
                    </div>
                  </CardContent>
                </Card>

                {/* Avg distance stats */}
                {(avgKmPerDay != null || avgKmPerMonth != null || avgKmPerFillup != null) && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      {avgKmPerDay != null && (
                        <StatRow label="Avg km per day" value={`${avgKmPerDay.toFixed(1)} km`} />
                      )}
                      {avgKmPerMonth != null && (
                        <>
                          <div className="h-px bg-border" />
                          <StatRow label="Avg km per month" value={`${avgKmPerMonth.toFixed(0)} km`} />
                        </>
                      )}
                      {avgKmPerFillup != null && (
                        <>
                          <div className="h-px bg-border" />
                          <StatRow label="Avg km per fill-up" value={`${avgKmPerFillup.toFixed(0)} km`} />
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Monthly distance bar chart */}
                {monthlyDistanceData.length >= 2 && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Distance by month</p>
                      <div className="flex items-end gap-1.5 h-24">
                        {(() => {
                          const maxKm = Math.max(...monthlyDistanceData.map((m) => m.km), 1);
                          return monthlyDistanceData.map((m) => {
                            const pct = (m.km / maxKm) * 100;
                            return (
                              <div key={m.month} className="flex-1 flex flex-col items-center h-full">
                                <div className="flex-1 w-full flex flex-col justify-end">
                                  <span className="text-[8px] text-primary font-semibold text-center tabular-nums mb-0.5 block leading-none">
                                    {m.km.toFixed(0)}
                                  </span>
                                  <div className="w-full bg-primary rounded-t-sm min-h-[3px]" style={{ height: `${pct}%` }} />
                                </div>
                                <span className="text-muted-foreground text-[9px] tabular-nums mt-1">{m.month.slice(5)}</span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">km per month</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
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

function StatCard({ label, value, Icon, sub }: { label: string; value: string; Icon: React.ElementType; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <Icon className="size-4 text-primary mb-2" />
        <p className="text-base font-bold tabular-nums leading-none">{value}</p>
        {sub && <p className="text-[11px] text-primary/70 tabular-nums mt-0.5 font-medium">{sub}</p>}
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

function StatRow({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "destructive" }) {
  const valueClass = accent === "emerald"
    ? "font-bold tabular-nums text-emerald-600"
    : accent === "destructive"
    ? "font-bold tabular-nums text-destructive"
    : "font-bold tabular-nums";
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

function PeriodCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={["rounded-lg p-3", highlight ? "bg-primary/5" : "bg-muted/40"].join(" ")}>
      <p className={["text-[10px] font-semibold uppercase tracking-widest mb-1", highlight ? "text-primary" : "text-muted-foreground"].join(" ")}>
        {label}
      </p>
      <p className="text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ChartFilterPills({
  value, onChange,
}: {
  value: "all" | "ytd" | "prev_year" | "this_month";
  onChange: (v: "all" | "ytd" | "prev_year" | "this_month") => void;
}) {
  const options: { id: "all" | "ytd" | "prev_year" | "this_month"; label: string }[] = [
    { id: "ytd", label: "YTD" },
    { id: "prev_year", label: "Prev yr" },
    { id: "this_month", label: "This mo" },
    { id: "all", label: "All" },
  ];
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={[
            "px-2 py-0.5 rounded-full text-[10px] font-medium transition-all",
            value === o.id
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
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

function YtdPill({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={[
      "rounded-xl px-3.5 py-2.5 min-w-[80px]",
      accent ? "bg-primary/8 border border-primary/15" : "bg-muted/60",
    ].join(" ")}>
      <p className={["text-base font-bold tabular-nums leading-none", accent ? "text-primary" : "text-foreground"].join(" ")}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap">{label}</p>
    </div>
  );
}
