"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, CheckCircle, AlertCircle, FileText } from "lucide-react";
import {
  parseFuelioCSV,
  parseFuelioOdometer,
  parseFuelioFuelMl,
  parseFuelioCurrencyMinor,
  type FuelioParsedCSV,
  type FuelioLogRow,
} from "@spencare/domain-core";
import type { VehicleRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { bulkImportFuelEntriesAction } from "../../actions";

interface Props {
  vehicle: VehicleRow;
}

function rowToImport(e: FuelioLogRow, currency: string, fuelType: string) {
  const odometerDkm = parseFuelioOdometer(e.odoRaw);
  const fuelQuantityMl = parseFuelioFuelMl(e.fuelRaw);
  const totalCostMinor = e.priceRaw.trim() ? parseFuelioCurrencyMinor(e.priceRaw) : null;
  const occurredAt = e.date.slice(0, 10);
  const isFullTank = e.full === "1";
  const isMissed = e.missed === "1";
  const importGuid = e.guid || e.uniqueId;

  return {
    occurredAt,
    odometer: Number(odometerDkm),
    fuelQuantityMl: Number(fuelQuantityMl),
    totalCostMinor: totalCostMinor !== null ? Number(totalCostMinor) : null,
    currency,
    fuelType,
    isFullTank,
    isMissed,
    importGuid,
  };
}

export function FuelioImport({ vehicle }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [parseResult, setParseResult] = useState<FuelioParsedCSV | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);

  function handleFile(file: File) {
    setImportResult(null);
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      if (typeof content !== "string") return;
      const result = parseFuelioCSV(content);
      if (result.logs.length === 0) {
        setParseError("No fuel log entries found in this file. Make sure it's a Fuelio CSV export.");
        setParseResult(null);
      } else {
        setParseResult(result);
      }
    };
    reader.readAsText(file);
  }

  function handleImport() {
    if (!parseResult) return;
    const currency = "INR";
    const fuelType = vehicle.fuel_type;
    startTransition(async () => {
      const entries = parseResult.logs.map((e) => rowToImport(e, currency, fuelType));
      const result = await bulkImportFuelEntriesAction(vehicle.id, entries);
      if (result.ok) {
        setImportResult(result.value);
        setParseResult(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/vehicles/${vehicle.id}`)}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Import from Fuelio</h1>
          <p className="text-sm text-muted-foreground">{vehicle.name}</p>
        </div>
      </div>

      {importResult ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle className="size-5" />
              <span className="font-medium">Import complete</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold">{importResult.imported}</div>
                <div className="text-muted-foreground">Imported</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-muted-foreground">{importResult.skipped}</div>
                <div className="text-muted-foreground">Skipped</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-destructive">{importResult.errors}</div>
                <div className="text-muted-foreground">Errors</div>
              </div>
            </div>
            <Button className="w-full" onClick={() => router.push(`/vehicles/${vehicle.id}`)}>
              Back to vehicle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="size-4" />
                Select Fuelio CSV file
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Export your vehicle&apos;s log from Fuelio as a CSV file, then upload it here.
                Duplicate entries are skipped automatically.
              </p>
              <label className="flex flex-col items-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/50 transition-colors">
                <FileText className="size-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Click to choose a CSV file</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </label>
              {parseError && (
                <div className="flex items-start gap-2 text-destructive text-sm">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {parseResult && parseResult.logs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Preview — {parseResult.logs.length} entries</span>
                  {parseResult.vehicle && (
                    <Badge variant="secondary">{parseResult.vehicle.name}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                  {parseResult.logs.map((e, i) => {
                    const litres = (Number(parseFuelioFuelMl(e.fuelRaw)) / 1000).toFixed(2);
                    const odo = (Number(parseFuelioOdometer(e.odoRaw)) / 10).toFixed(1);
                    const cost = e.priceRaw.trim()
                      ? (Number(parseFuelioCurrencyMinor(e.priceRaw)) / 100).toFixed(2)
                      : null;
                    return (
                      <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground w-24">{e.date.slice(0, 10)}</span>
                          <span>{litres} L</span>
                          {e.full === "1" && <Badge variant="secondary" className="text-xs">Full</Badge>}
                          {e.missed === "1" && <Badge variant="outline" className="text-xs text-muted-foreground">Missed</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span>{odo} km</span>
                          {cost !== null && <span>₹{cost}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {parseResult.parseErrors.length > 0 && (
                  <p className="text-xs text-amber-600">{parseResult.parseErrors.length} row(s) had parse warnings.</p>
                )}
                <Button className="w-full" onClick={handleImport} disabled={isPending}>
                  {isPending ? "Importing…" : `Import ${parseResult.logs.length} entries`}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
