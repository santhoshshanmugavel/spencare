"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Car, Plus, Trash2, Fuel, Zap, Truck, Bike, Gauge, Camera } from "lucide-react";
import type { VehicleRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createVehicleAction, deleteVehicleAction, updateVehiclePhotoAction } from "./actions";

// ── Vehicle type config ─────────────────────────────────────────────────────

type VehicleType = "motorcycle" | "scooter" | "car" | "ev" | "truck" | "van" | "other";

const VEHICLE_ICON: Record<VehicleType, React.ElementType> = {
  motorcycle: Bike,
  scooter: Bike,
  car: Car,
  ev: Zap,
  truck: Truck,
  van: Car,
  other: Car,
};

function getIcon(vehicleType: string): React.ElementType {
  return VEHICLE_ICON[vehicleType as VehicleType] ?? Car;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface VehiclesListProps {
  initialVehicles: VehicleRow[];
  masked: boolean;
  vehiclePhotoUrls?: Record<string, string>;
}

// ── Main component ──────────────────────────────────────────────────────────

export function VehiclesList({ initialVehicles, vehiclePhotoUrls = {} }: VehiclesListProps) {
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Vehicles</h1>
        <Button onClick={() => { setShowCreate(true); resetForm(); }}>
          <Plus className="size-4 mr-1" /> Add vehicle
        </Button>
      </div>

      {/* Empty state */}
      {vehicles.length === 0 ? (
        <div className="border border-dashed rounded-2xl flex flex-col items-center gap-4 py-16 px-6 text-center">
          <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Car className="size-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold mb-1">No vehicles yet</p>
            <p className="text-muted-foreground text-sm">Add a vehicle to start tracking fuel and expenses.</p>
          </div>
          <Button
            onClick={() => { setShowCreate(true); resetForm(); }}
            className="mt-2"
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
              photoUrl={vehiclePhotoUrls[v.id] ?? null}
              isPending={isPending}
              onNavigate={() => router.push(`/vehicles/${v.id}`)}
              onDelete={() => handleDelete(v.id)}
            />
          ))}
        </div>
      )}

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
              {isPending ? "Saving..." : "Add vehicle"}
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
  photoUrl: initialPhotoUrl,
  isPending,
  onNavigate,
  onDelete,
}: {
  vehicle: VehicleRow;
  photoUrl: string | null;
  isPending: boolean;
  onNavigate: () => void;
  onDelete: () => void;
}) {
  const Icon = getIcon(v.vehicle_type);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [isUploading, startUpload] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("image", file);
    startUpload(async () => {
      const result = await updateVehiclePhotoAction(v.id, formData);
      if (result.ok) setPhotoUrl(result.value.signedUrl);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div
      className="rounded-2xl overflow-hidden bg-card border cursor-pointer hover:border-primary/30 hover:shadow-md transition-all group"
      onClick={onNavigate}
    >
      {/* Hero section */}
      <div className="relative h-48 bg-primary/8 flex items-center justify-center overflow-hidden">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={v.name} className="size-full object-cover" />
        ) : (
          <Icon className="size-20 text-primary/12" strokeWidth={1} />
        )}

        {/* Upload spinner overlay */}
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        {/* Camera upload button */}
        {!isUploading && (
          <button
            className={`absolute transition-all ${
              photoUrl
                ? "bottom-2.5 right-2.5 size-8 rounded-full bg-background/80 backdrop-blur-sm border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm"
                : "inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100"
            }`}
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
            aria-label={photoUrl ? `Change ${v.name} photo` : `Add photo for ${v.name}`}
          >
            {photoUrl ? (
              <Camera className="size-3.5 text-foreground" />
            ) : (
              <span className="flex items-center gap-1.5 rounded-xl bg-background/85 backdrop-blur-sm border border-border px-3 py-2 text-xs font-semibold text-foreground shadow-sm">
                <Camera className="size-3.5" /> Add photo
              </span>
            )}
          </button>
        )}

        {/* Delete button */}
        <button
          className="absolute top-3 right-3 size-7 rounded-full bg-background/70 hover:bg-destructive/10 flex items-center justify-center text-muted-foreground/40 hover:text-destructive transition-all opacity-0 group-hover:opacity-100"
          disabled={isPending}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label="Delete vehicle"
        >
          <Trash2 className="size-3.5" />
        </button>

        {/* Fuel type badge */}
        <div className="absolute bottom-3 left-3">
          <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full capitalize font-medium ${photoUrl ? "bg-background/80 backdrop-blur-sm text-foreground" : "bg-primary/10 text-primary"}`}>
            <Fuel className="size-2.5" />
            {v.fuel_type}
          </span>
        </div>

        {/* Archived badge */}
        {v.status === "archived" && (
          <div className="absolute top-3 left-3">
            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Archived</span>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={handleFileChange}
        />
      </div>

      {/* Info section */}
      <div className="p-4 space-y-2">
        <div>
          <h3 className="font-bold text-base leading-snug line-clamp-1">{v.name}</h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-primary text-xs capitalize">{v.vehicle_type}</span>
            {(v.make || v.model) && (
              <>
                <span className="text-muted-foreground/40 text-xs">·</span>
                <span className="text-muted-foreground text-xs line-clamp-1">
                  {[v.make, v.model].filter(Boolean).join(" ")}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          {v.registration_number ? (
            <span className="text-primary text-xs font-mono tracking-widest">
              {v.registration_number}
            </span>
          ) : (
            <span />
          )}
          {v.current_odometer != null && v.current_odometer > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground text-xs tabular-nums">
              <Gauge className="size-3" />
              {(v.current_odometer / 10).toFixed(1)} km
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
