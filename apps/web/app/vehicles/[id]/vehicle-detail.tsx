"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Fuel, Wrench, FileText, Bell, DollarSign, BarChart3, Plus, Trash2 } from "lucide-react";
import type {
  VehicleMaintenanceRow,
  VehicleDocumentRow,
  VehicleReminderRow,
} from "@spencare/domain-application";
import type { VehicleDashboardData } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

interface VehicleDetailProps {
  dashboard: VehicleDashboardData;
  maintenanceRecords: VehicleMaintenanceRow[];
  documents: VehicleDocumentRow[];
  reminders: VehicleReminderRow[];
  masked: boolean;
}

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

function daysUntil(dateStr: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const diff = Date.parse(dateStr) - Date.parse(today);
  return Math.round(diff / 86_400_000);
}

export function VehicleDetail({
  dashboard,
  maintenanceRecords: initialMaintenance,
  documents: initialDocuments,
  reminders: initialReminders,
  masked,
}: VehicleDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Mutable state for each section
  const [fuelEntries, setFuelEntries] = useState(dashboard.fuelEntries);
  const [expenses, setExpenses] = useState(dashboard.expenses);
  const [maintenance, setMaintenance] = useState(initialMaintenance);
  const [documents, setDocuments] = useState(initialDocuments);
  const [reminders, setReminders] = useState(initialReminders);

  const vehicleId = dashboard.vehicle.id;
  const currency = dashboard.currency;

  // ---- Fuel dialog ----
  const [showFuelDialog, setShowFuelDialog] = useState(false);
  const [fuelDate, setFuelDate] = useState(new Date().toISOString().slice(0, 10));
  const [fuelOdometer, setFuelOdometer] = useState("");
  const [fuelLitres, setFuelLitres] = useState("");
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

  // ---- Expense dialog ----
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

  // ---- Maintenance dialog ----
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

  // ---- Document dialog ----
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

  // ---- Stats overview ----
  const efficiency = dashboard.efficiency;
  const costPerKm = dashboard.costPerKm;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/vehicles")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{dashboard.vehicle.name}</h1>
          <div className="flex gap-1.5 mt-1">
            <Badge variant="secondary" className="capitalize text-xs">{dashboard.vehicle.vehicle_type}</Badge>
            <Badge variant="outline" className="capitalize text-xs">{dashboard.vehicle.fuel_type}</Badge>
            {dashboard.vehicle.registration_number && (
              <Badge variant="outline" className="font-mono text-xs">{dashboard.vehicle.registration_number}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total fuel cost"
          value={fmtAmount(dashboard.totalFuelCostMinor, currency, masked)}
        />
        <StatCard
          label="Other expenses"
          value={fmtAmount(dashboard.totalOtherCostMinor, currency, masked)}
        />
        <StatCard
          label="Fuel efficiency"
          value={
            efficiency.type === "computed"
              ? `${(Number(efficiency.kmPerLitreCx100) / 100).toFixed(1)} km/L`
              : "—"
          }
        />
        <StatCard
          label="Cost per km"
          value={
            costPerKm.type === "computed" && !masked
              ? `${fmtAmount(Number(costPerKm.costPerKmCx100) / 100, currency, false)}/km`
              : costPerKm.type === "computed" && masked
              ? "***"
              : "—"
          }
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="fuel">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="fuel" className="gap-1.5"><Fuel className="size-3.5" /> Fuel</TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5"><DollarSign className="size-3.5" /> Expenses</TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-1.5"><Wrench className="size-3.5" /> Maintenance</TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5"><FileText className="size-3.5" /> Documents</TabsTrigger>
          <TabsTrigger value="reminders" className="gap-1.5">
            <Bell className="size-3.5" /> Reminders
            {reminders.length > 0 && (
              <Badge variant="destructive" className="size-4 p-0 text-[9px] flex items-center justify-center">
                {reminders.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5"><BarChart3 className="size-3.5" /> Analytics</TabsTrigger>
        </TabsList>

        {/* ---- Fuel tab ---- */}
        <TabsContent value="fuel" className="mt-4 space-y-3">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push(`/vehicles/${vehicleId}/import`)}>
              Import CSV
            </Button>
            <Button size="sm" onClick={() => setShowFuelDialog(true)}>
              <Plus className="size-4 mr-1" /> Log fuel
            </Button>
          </div>
          {fuelEntries.length === 0 ? (
            <EmptyState icon={<Fuel className="size-8" />} message="No fuel entries yet." />
          ) : (
            <div className="space-y-2">
              {fuelEntries.map((e) => (
                <Card key={e.id}>
                  <CardContent className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{e.occurred_at}</span>
                        {e.is_full_tank && <Badge variant="secondary" className="text-xs">Full tank</Badge>}
                        {e.is_missed && <Badge variant="outline" className="text-xs text-muted-foreground">Missed</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                        <span>{fmtLitres(Number(e.fuel_quantity_ml))}</span>
                        <span>{fmtOdometer(Number(e.odometer))}</span>
                        {e.total_cost_minor != null && (
                          <span>{fmtAmount(Number(e.total_cost_minor), e.currency, masked)}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive shrink-0"
                      disabled={isPending}
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
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Expenses tab ---- */}
        <TabsContent value="expenses" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowExpenseDialog(true)}>
              <Plus className="size-4 mr-1" /> Add expense
            </Button>
          </div>
          {expenses.length === 0 ? (
            <EmptyState icon={<DollarSign className="size-8" />} message="No expenses yet." />
          ) : (
            <div className="space-y-2">
              {expenses.map((e) => (
                <Card key={e.id}>
                  <CardContent className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{e.occurred_at}</span>
                        <Badge variant="secondary" className="capitalize text-xs">{e.expense_category}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                        <span>{fmtAmount(Number(e.amount_minor), e.currency, masked)}</span>
                        {e.description && <span>{e.description}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive shrink-0"
                      disabled={isPending}
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
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Maintenance tab ---- */}
        <TabsContent value="maintenance" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowMaintenanceDialog(true)}>
              <Plus className="size-4 mr-1" /> Add record
            </Button>
          </div>
          {maintenance.length === 0 ? (
            <EmptyState icon={<Wrench className="size-8" />} message="No maintenance records yet." />
          ) : (
            <div className="space-y-2">
              {maintenance.map((m) => (
                <Card key={m.id}>
                  <CardContent className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{m.title}</span>
                        <Badge variant="secondary" className="capitalize text-xs">{m.maintenance_category}</Badge>
                        {m.status === "overdue" && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                        {m.serviced_at && <span>Serviced: {m.serviced_at}</span>}
                        {m.next_due_date && <span>Next: {m.next_due_date}</span>}
                        {m.cost_minor != null && m.currency && (
                          <span>{fmtAmount(Number(m.cost_minor), m.currency, masked)}</span>
                        )}
                        {m.vendor && <span>{m.vendor}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive shrink-0"
                      disabled={isPending}
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
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Documents tab ---- */}
        <TabsContent value="documents" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowDocDialog(true)}>
              <Plus className="size-4 mr-1" /> Add document
            </Button>
          </div>
          {documents.length === 0 ? (
            <EmptyState icon={<FileText className="size-8" />} message="No documents yet." />
          ) : (
            <div className="space-y-2">
              {documents.map((d) => {
                const daysLeft = d.expiry_date ? daysUntil(d.expiry_date) : null;
                const urgency =
                  daysLeft === null ? "none" :
                  daysLeft < 0 ? "expired" :
                  daysLeft <= 7 ? "urgent" :
                  daysLeft <= 30 ? "warning" : "ok";
                return (
                  <Card key={d.id}>
                    <CardContent className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{d.title}</span>
                          <Badge variant="secondary" className="uppercase text-xs">{d.document_type}</Badge>
                          {urgency === "expired" && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                          {urgency === "urgent" && <Badge variant="destructive" className="text-xs">{daysLeft}d left</Badge>}
                          {urgency === "warning" && <Badge variant="outline" className="text-xs text-amber-600">{daysLeft}d left</Badge>}
                        </div>
                        {d.expiry_date && (
                          <div className="text-xs text-muted-foreground mt-0.5">Expires: {d.expiry_date}</div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive shrink-0"
                        disabled={isPending}
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
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ---- Reminders tab ---- */}
        <TabsContent value="reminders" className="mt-4 space-y-3">
          {reminders.length === 0 ? (
            <EmptyState icon={<Bell className="size-8" />} message="No active reminders." />
          ) : (
            <div className="space-y-2">
              {reminders.map((r) => {
                const daysLeft = r.due_date ? daysUntil(r.due_date) : null;
                return (
                  <Card key={r.id}>
                    <CardContent className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{r.title}</span>
                          <Badge
                            variant={daysLeft !== null && daysLeft <= 7 ? "destructive" : "secondary"}
                            className="text-xs capitalize"
                          >
                            {r.reminder_type.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {r.due_date && (
                            <span>
                              Due {r.due_date}
                              {daysLeft !== null && (
                                daysLeft < 0 ? " (overdue)" : daysLeft === 0 ? " (today)" : ` (${daysLeft}d)`
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-xs h-7"
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
        </TabsContent>

        {/* ---- Analytics tab ---- */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly costs</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.monthlyCosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="space-y-2">
                  {dashboard.monthlyCosts.slice(0, 12).map((m) => (
                    <div key={m.month} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{m.month}</span>
                      <div className="flex gap-4">
                        <span className="text-xs text-muted-foreground">
                          Fuel {fmtAmount(Number(m.fuelCostMinor), currency, masked)}
                        </span>
                        {m.otherCostMinor > 0n && (
                          <span className="text-xs text-muted-foreground">
                            Other {fmtAmount(Number(m.otherCostMinor), currency, masked)}
                          </span>
                        )}
                        <span className="font-medium">
                          {fmtAmount(Number(m.totalCostMinor), currency, masked)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {efficiency.type === "computed" && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fuel efficiency</span>
                  <span className="font-medium">{(Number(efficiency.kmPerLitreCx100) / 100).toFixed(2)} km/L</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Based on</span>
                  <span>{efficiency.intervalCount} full-tank interval{efficiency.intervalCount !== 1 ? "s" : ""}</span>
                </div>
              </CardContent>
            </Card>
          )}
          {efficiency.type === "insufficient_data" && (
            <p className="text-sm text-muted-foreground px-1">
              Fuel efficiency requires at least two consecutive full-tank fill-ups. Log more full-tank entries to see calculations.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* ---- Fuel dialog ---- */}
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
                <Input type="number" min="0" step="0.1" placeholder="e.g. 1234.5" value={fuelOdometer} onChange={(e) => setFuelOdometer(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fuel (litres) *</Label>
                <Input type="number" min="0.001" step="0.01" placeholder="e.g. 10.08" value={fuelLitres} onChange={(e) => setFuelLitres(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Total cost</Label>
                <Input type="number" min="0" step="0.01" placeholder="e.g. 1174.82" value={fuelCost} onChange={(e) => setFuelCost(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="full-tank"
                checked={fuelIsFull}
                onCheckedChange={(v) => setFuelIsFull(v === true)}
              />
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

      {/* ---- Expense dialog ---- */}
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

      {/* ---- Maintenance dialog ---- */}
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

      {/* ---- Document dialog ---- */}
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold mt-0.5 tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
        {icon}
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
