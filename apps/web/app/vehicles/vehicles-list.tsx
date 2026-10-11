"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, Plus, Trash2, Fuel, Zap, Truck, Bike, Gauge } from "lucide-react";
import type { VehicleRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createVehicleAction, deleteVehicleAction } from "./actions";

// ── Vehicle type config ─────────────────────────────────────────────────────

type VehicleType = "motorcycle" | "scooter" | "car" | "ev" | "truck" | "van" | "other";

const VEHICLE_CONFIG: Record<VehicleType, { gradient: string; Icon: React.ElementType }> = {
  motorcycle: { gradient: "from-teal-800 via-teal-900 to-slate-950", Icon: Bike },
  scooter: { gradient: "from-teal-700 via-teal-900 to-slate-950", Icon: Bike },
  car: { gradient: "from-cyan-800 via-teal-900 to-slate-950", Icon: Car },
  ev: { gradient: "from-emerald-700 via-teal-900 to-slate-950", Icon: Zap },
  truck: { gradient: "from-stone-700 via-stone-900 to-slate-950", Icon: Truck },
  van: { gradient: "from-blue-800 via-teal-900 to-slate-950", Icon: Car },
  other: { gradient: "from-teal-900 via-slate-900 to-slate-950", Icon: Car },
};

function getConfig(vehicleType: string) {
  return VEHICLE_CONFIG[vehicleType as VehicleType] ?? VEHICLE_CONFIG.other;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface VehiclesListProps {
  initialVehicles: VehicleRow[];
  masked: boolean;
}

// ── Main component ──────────────────────────────────────────────────────────

export function VehiclesList({ initialVehicles }: VehiclesListProps) {
  const router = useRouter();
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [vehicleType, setVehicleType] = useState("motorcycle");
  const [fuelType, setFuelType] = useState("petrol");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [regNumber, setRegNumber] = useState("");

  function resetForm() {
    setName("");
    setVehicleType("motorcycle");
    setFuelType("petrol");
    setMake("");
    setModel("");
    setRegNumber("");
    setError(null);
  }

  function handleCreate() {
    if (!name.trim()) { setError("Vehicle name is required."); return; }
    startTransition(async () => {
      const result = await createVehicleAction({
        name: name.trim(),
        vehicleType,
        fuelType,
        odometerUnit: "km",
        fuelUnit: "litre",
        make: make.trim() || null,
        model: model.trim() || null,
        registrationNumber: regNumber.trim() || null,
      });
      if (result.ok) {
        setVehicles((prev) => [result.value, ...prev]);
        setShowCreate(false);
        resetForm();
      } else {
        setError(result.error.message);
      }
    });
  }

  function handleDelete(vehicleId: string) {
    if (!confirm("Delete this vehicle and all its data? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteVehicleAction(vehicleId);
      if (result.ok) {
        setVehicles((prev) => prev.filter((v) => v.id !== vehicleId));
      }
    });
  }

  return (
    <div className="pb-24">
      {/* Page title */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Vehicles</h1>
        <span className="text-sm text-muted-foreground tabular-nums">
          {vehicles.length > 0 ? `${vehicles.length} vehicle${vehicles.length !== 1 ? "s" : ""}` : ""}
        </span>
      </div>

      {/* Empty state */}
      {vehicles.length === 0 ? (
        <div className="bg-teal-950 rounded-2xl border border-teal-900 flex flex-col items-center gap-4 py-16 px-6 text-center">
          <div className="size-16 rounded-full bg-teal-900 flex items-center justify-center">
            <Car className="size-8 text-teal-700" />
          </div>
          <div>
            <p className="text-white font-semibold mb-1">No vehicles yet</p>
            <p className="text-teal-600 text-sm">Add a vehicle to start tracking fuel and expenses.</p>
          </div>
          <Button
            className="bg-teal-500 hover:bg-teal-400 text-teal-950 font-semibold mt-2"
            onClick={() => { setShowCreate(true); resetForm(); }}
          >
            <Plus className="size-4 mr-1" /> Add your first vehicle
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((v) => (
            <VehicleHeroCard
              key={v.id}
              vehicle={v}
              isPending={isPending}
              onNavigate={() => router.push(`/vehicles/${v.id}`)}
              onDelete={() => handleDelete(v.id)}
            />
          ))}
        </div>
      )}

      {/* Floating "+" FAB */}
      <button
        className="fixed bottom-6 right-6 z-50 size-14 rounded-full bg-teal-500 hover:bg-teal-400 active:bg-teal-300 text-teal-950 shadow-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        onClick={() => { setShowCreate(true); resetForm(); }}
        aria-label="Add vehicle"
      >
        <Plus className="size-6" strokeWidth={2.5} />
      </button>

      {/* Add vehicle dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => { if (!open) { setShowCreate(false); resetForm(); } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add vehicle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                placeholder="e.g. Royal Enfield Hunter 350"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={vehicleType} onValueChange={setVehicleType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="motorcycle">Motorcycle</SelectItem>
                    <SelectItem value="scooter">Scooter</SelectItem>
                    <SelectItem value="car">Car</SelectItem>
                    <SelectItem value="ev">EV</SelectItem>
                    <SelectItem value="truck">Truck</SelectItem>
                    <SelectItem value="van">Van</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fuel type</Label>
                <Select value={fuelType} onValueChange={setFuelType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="petrol">Petrol</SelectItem>
                    <SelectItem value="diesel">Diesel</SelectItem>
                    <SelectItem value="electric">Electric</SelectItem>
                    <SelectItem value="cng">CNG</SelectItem>
                    <SelectItem value="lpg">LPG</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Make</Label>
                <Input
                  placeholder="e.g. Royal Enfield"
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input
                  placeholder="e.g. Hunter 350"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Registration number</Label>
              <Input
                placeholder="e.g. KA 01 AB 1234"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value)}
                className="uppercase"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending ? "Saving…" : "Add vehicle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Vehicle hero card ───────────────────────────────────────────────────────

function VehicleHeroCard({
  vehicle: v,
  isPending,
  onNavigate,
  onDelete,
}: {
  vehicle: VehicleRow;
  isPending: boolean;
  onNavigate: () => void;
  onDelete: () => void;
}) {
  const { gradient, Icon } = getConfig(v.vehicle_type);

  return (
    <div
      className="rounded-2xl overflow-hidden bg-teal-950 border border-teal-900/60 cursor-pointer hover:border-teal-700/60 transition-all hover:shadow-lg hover:shadow-teal-950/50 group"
      onClick={onNavigate}
    >
      {/* Gradient hero section */}
      <div className={`relative h-36 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        <Icon className="size-16 text-white/15" strokeWidth={1} />
        {/* Delete button top-right */}
        <button
          className="absolute top-3 right-3 size-7 rounded-full bg-black/25 hover:bg-red-950/80 flex items-center justify-center text-white/40 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
          disabled={isPending}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label="Delete vehicle"
        >
          <Trash2 className="size-3.5" />
        </button>
        {/* Fuel type badge bottom-left */}
        <div className="absolute bottom-3 left-3">
          <span className="flex items-center gap-1 text-[10px] bg-black/30 text-white/70 px-2 py-0.5 rounded-full capitalize">
            <Fuel className="size-2.5" />
            {v.fuel_type}
          </span>
        </div>
        {/* Status badge */}
        {v.status === "archived" && (
          <div className="absolute top-3 left-3">
            <span className="text-[10px] bg-red-900/60 text-red-300 px-2 py-0.5 rounded-full">Archived</span>
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="p-4 space-y-2">
        <div>
          <h3 className="text-white font-bold text-base leading-snug line-clamp-1">{v.name}</h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-teal-500 text-xs capitalize">{v.vehicle_type}</span>
            {(v.make || v.model) && (
              <>
                <span className="text-teal-800 text-xs">·</span>
                <span className="text-teal-600 text-xs line-clamp-1">
                  {[v.make, v.model].filter(Boolean).join(" ")}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          {v.registration_number ? (
            <span className="text-teal-500 text-xs font-mono tracking-widest">
              {v.registration_number}
            </span>
          ) : (
            <span />
          )}
          {v.current_odometer != null && v.current_odometer > 0 && (
            <span className="flex items-center gap-1 text-teal-600 text-xs tabular-nums">
              <Gauge className="size-3" />
              {(v.current_odometer / 10).toFixed(1)} km
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
