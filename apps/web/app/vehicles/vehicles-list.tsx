"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, Plus, Trash2, Pencil } from "lucide-react";
import type { VehicleRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createVehicleAction, deleteVehicleAction } from "./actions";

interface VehiclesListProps {
  initialVehicles: VehicleRow[];
  masked: boolean;
}

export function VehiclesList({ initialVehicles }: VehiclesListProps) {
  const router = useRouter();
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form state
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Vehicles</h1>
        <Button onClick={() => { setShowCreate(true); resetForm(); }} size="sm">
          <Plus className="size-4 mr-1" /> Add vehicle
        </Button>
      </div>

      {vehicles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <Car className="size-10" />
            <p className="text-sm">No vehicles yet. Add one to start tracking fuel and expenses.</p>
            <Button variant="outline" size="sm" onClick={() => { setShowCreate(true); resetForm(); }}>
              <Plus className="size-4 mr-1" /> Add your first vehicle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((v) => (
            <Card
              key={v.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => router.push(`/vehicles/${v.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug">{v.name}</CardTitle>
                  <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => router.push(`/vehicles/${v.id}`)}
                      title="Edit"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(v.id)}
                      disabled={isPending}
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="capitalize text-xs">{v.vehicle_type}</Badge>
                  <Badge variant="outline" className="capitalize text-xs">{v.fuel_type}</Badge>
                  {v.status === "archived" && <Badge variant="destructive" className="text-xs">Archived</Badge>}
                </div>
                {(v.make || v.model) && (
                  <p className="text-sm text-muted-foreground">
                    {[v.make, v.model, v.variant].filter(Boolean).join(" ")}
                  </p>
                )}
                {v.registration_number && (
                  <p className="text-xs font-mono text-muted-foreground">{v.registration_number}</p>
                )}
                {v.current_odometer != null && (
                  <p className="text-xs text-muted-foreground">
                    Odometer: {(v.current_odometer / 10).toFixed(1)} km
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); resetForm(); } }}>
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
                <Input placeholder="e.g. Royal Enfield" value={make} onChange={(e) => setMake(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Model</Label>
                <Input placeholder="e.g. Hunter 350" value={model} onChange={(e) => setModel(e.target.value)} />
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
            <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending ? "Saving…" : "Add vehicle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
