"use client";

import { useState, useTransition, useRef } from "react";
import {
  parseGenericCSV,
  suggestColumnMapping,
  validateGenericRow,
  hasAmbiguousDates,
  type GenericCsvColumnMap,
  type GenericCsvField,
  type ValidatedGenericRow,
  type InvalidGenericRow,
} from "@spencare/domain-core";
import type { VehicleRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, CheckCircle, AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { bulkImportGenericFuelEntriesAction, checkImportDuplicatesAction } from "../../actions";

const FIELD_LABELS: Record<GenericCsvField, string> = {
  date: "Date",
  odometer: "Odometer",
  fuelQuantity: "Fuel quantity",
  totalCost: "Total cost",
  currency: "Currency",
  fuelType: "Fuel type",
  isFullTank: "Full tank",
  isMissed: "Missed fill",
  stationName: "Station name",
  notes: "Notes",
  ignore: "Ignore",
};

const REQUIRED_FIELDS: GenericCsvField[] = ["date", "odometer", "fuelQuantity"];

const ALL_FIELDS: GenericCsvField[] = [
  "date", "odometer", "fuelQuantity", "totalCost", "currency",
  "fuelType", "isFullTank", "isMissed", "stationName", "notes", "ignore",
];

interface Props {
  vehicle: VehicleRow;
}

type Step = "upload" | "map" | "preview" | "done";

interface PossibleDuplicate {
  occurredAt: string;
  odometer: number;
  fuelQuantityMl: number;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  possibleDuplicates: PossibleDuplicate[];
}

export function GenericImport({ vehicle }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<GenericCsvColumnMap>({});
  const [validRows, setValidRows] = useState<ValidatedGenericRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<InvalidGenericRow[]>([]);
  const [alreadyImportedGuids, setAlreadyImportedGuids] = useState<ReadonlySet<string>>(new Set());
  const [fileDuplicateGuids, setFileDuplicateGuids] = useState<ReadonlySet<string>>(new Set());
  const [excludedGuids, setExcludedGuids] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dateFormat, setDateFormat] = useState<"dmy" | "mdy">("dmy");
  const [showAmbiguous, setShowAmbiguous] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setFileError(null);
    if (!file.name.match(/\.(csv|txt)$/i)) {
      setFileError("Only .csv or .txt files are accepted.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError("File must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsed = parseGenericCSV(content);
      if (!parsed) {
        setFileError("The file appears to be empty or has no data rows.");
        return;
      }
      if (parsed.isFuelio) {
        setFileError("This looks like a Fuelio file. Please use the Fuelio tab to import it.");
        return;
      }
      const suggested = suggestColumnMapping(parsed.headers);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMap(suggested);
      setShowAmbiguous(hasAmbiguousDates(parsed.rows, suggested));
      setStep("map");
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function updateMapping(colIndex: number, field: GenericCsvField) {
    setMap((prev: GenericCsvColumnMap) => {
      const next: GenericCsvColumnMap = { ...prev };
      // Remove any other column currently mapped to the same field (except ignore).
      if (field !== "ignore") {
        for (const [k, v] of Object.entries(next)) {
          if (v === field) next[Number(k)] = "ignore";
        }
      }
      next[colIndex] = field;
      setShowAmbiguous(hasAmbiguousDates(rows, next));
      return next;
    });
  }

  function requiredFieldsMapped(): boolean {
    const mapped = new Set(Object.values(map));
    return REQUIRED_FIELDS.every((f) => mapped.has(f));
  }

  function goToPreview() {
    const currency = vehicle.purchase_currency ?? "INR";
    const fuelUnit = "litre";
    const good: ValidatedGenericRow[] = [];
    const bad: InvalidGenericRow[] = [];
    rows.forEach((row, i) => {
      const r = validateGenericRow(row, map, i + 2, currency, fuelUnit, dateFormat);
      if (r.valid) good.push(r);
      else bad.push(r);
    });

    // Detect rows whose importGuid appears more than once in this file.
    const guidCount = new Map<string, number>();
    good.forEach((r) => guidCount.set(r.importGuid, (guidCount.get(r.importGuid) ?? 0) + 1));
    const fileDupGuids = new Set<string>();
    guidCount.forEach((count, guid) => { if (count > 1) fileDupGuids.add(guid); });

    setValidRows(good);
    setInvalidRows(bad);
    setFileDuplicateGuids(fileDupGuids);
    setAlreadyImportedGuids(new Set());
    setExcludedGuids(fileDupGuids);

    startTransition(async () => {
      const guids = good.map((r) => r.importGuid);
      const checkRes = await checkImportDuplicatesAction(vehicle.id, "generic_csv", guids);
      if (checkRes.ok && checkRes.value.length > 0) {
        const existingSet = new Set(checkRes.value);
        setAlreadyImportedGuids(existingSet);
        setExcludedGuids((prev) => new Set([...prev, ...existingSet]));
      }
      setStep("preview");
    });
  }

  function toggleExcluded(guid: string) {
    setExcludedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  function runImport() {
    startTransition(async () => {
      const entries = validRows
        .filter((r) => !excludedGuids.has(r.importGuid))
        .map((r) => ({
          occurredAt: r.occurredAt,
          odometer: Number(r.odometerDkm),
          fuelQuantityMl: Number(r.fuelQuantityMl),
          totalCostMinor: r.totalCostMinor !== null ? Number(r.totalCostMinor) : null,
          currency: r.currency,
          fuelType: r.fuelType,
          isFullTank: r.isFullTank,
          isMissed: r.isMissed,
          importGuid: r.importGuid,
          stationName: r.stationName,
          notes: r.notes,
        }));
      const res = await bulkImportGenericFuelEntriesAction(vehicle.id, entries);
      if (res.ok) {
        setResult({
          imported: res.value.imported,
          skipped: res.value.skipped,
          errors: res.value.errors,
          possibleDuplicates: res.value.possibleDuplicates,
        });
        setStep("done");
      }
    });
  }

  function resetAll() {
    setStep("upload");
    setResult(null);
    setValidRows([]);
    setInvalidRows([]);
    setAlreadyImportedGuids(new Set());
    setFileDuplicateGuids(new Set());
    setExcludedGuids(new Set());
    setDateFormat("dmy");
    setShowAmbiguous(false);
  }

  if (step === "upload") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Import from CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload any CSV or TXT file with fuel log data. You will map the columns to the
            correct fields before importing.
          </p>
          <div
            className="border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Drop a CSV here or click to browse</p>
            <p className="text-xs text-muted-foreground">Max 5 MB, .csv or .txt</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
          {fileError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {fileError}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (step === "map") {
    const sampleRows = rows.slice(0, 3);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Map columns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Tell us what each column contains. Required fields are marked with an asterisk.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium">Column</th>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium">Maps to</th>
                  <th className="text-left px-2 py-1 text-muted-foreground font-medium" colSpan={3}>
                    Sample values
                  </th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-2 font-mono text-xs">{header}</td>
                    <td className="px-2 py-2 min-w-[160px]">
                      <Select
                        value={map[i] ?? "ignore"}
                        onValueChange={(v) => updateMapping(i, v as GenericCsvField)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>
                              {FIELD_LABELS[f]}
                              {REQUIRED_FIELDS.includes(f) ? " *" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    {sampleRows.map((row, ri) => (
                      <td key={ri} className="px-2 py-2 font-mono text-xs text-muted-foreground max-w-[120px] truncate">
                        {row[i] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">* Required</p>
          {showAmbiguous && (
            <div className="border rounded-md p-3 space-y-2 bg-muted/30">
              <p className="text-sm font-medium">Date format</p>
              <p className="text-xs text-muted-foreground">
                Some dates could be read as either DD/MM or MM/DD. Choose which format your file uses.
              </p>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="dateFormat"
                    value="dmy"
                    checked={dateFormat === "dmy"}
                    onChange={() => setDateFormat("dmy")}
                  />
                  DD/MM/YYYY
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="dateFormat"
                    value="mdy"
                    checked={dateFormat === "mdy"}
                    onChange={() => setDateFormat("mdy")}
                  />
                  MM/DD/YYYY
                </label>
              </div>
            </div>
          )}
          {!requiredFieldsMapped() && (
            <div className="flex items-center gap-2 text-amber-600 text-sm">
              <AlertCircle className="h-4 w-4" />
              Please map Date, Odometer, and Fuel quantity before continuing.
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("upload")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button onClick={goToPreview} disabled={!requiredFieldsMapped() || isPending}>
              {isPending ? "Checking..." : "Preview import"} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "preview") {
    const newRows = validRows.filter((r) => !alreadyImportedGuids.has(r.importGuid) && !fileDuplicateGuids.has(r.importGuid));
    const duplicateRows = validRows.filter((r) => alreadyImportedGuids.has(r.importGuid));
    const sameFileDuplicateRows = validRows.filter((r) => fileDuplicateGuids.has(r.importGuid) && !alreadyImportedGuids.has(r.importGuid));
    const importCount = validRows.filter((r) => !excludedGuids.has(r.importGuid)).length;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <Badge variant="secondary">{newRows.length} new</Badge>
            {sameFileDuplicateRows.length > 0 && (
              <Badge variant="outline">{sameFileDuplicateRows.length} same-file duplicate{sameFileDuplicateRows.length !== 1 ? "s" : ""}</Badge>
            )}
            {duplicateRows.length > 0 && (
              <Badge variant="outline">{duplicateRows.length} already imported</Badge>
            )}
            {invalidRows.length > 0 && (
              <Badge variant="destructive">{invalidRows.length} invalid</Badge>
            )}
          </div>

          {sameFileDuplicateRows.length > 0 && (
            <div className="border rounded-md p-3 space-y-2 bg-muted/20">
              <p className="text-sm font-medium">Same-file duplicates</p>
              <p className="text-xs text-muted-foreground">
                These rows share the same date, odometer, and fuel quantity as another row in this
                file. They are excluded by default. Include only if you believe they represent
                distinct purchases; at most one row per group will be accepted.
              </p>
              <div className="overflow-x-auto max-h-40 overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="sticky top-0 bg-background">
                      <th className="text-left px-2 py-1 text-muted-foreground w-8">Include</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Date</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Odometer (km)</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Fuel (mL)</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sameFileDuplicateRows.map((r) => {
                      const included = !excludedGuids.has(r.importGuid);
                      return (
                        <tr key={r.sourceRow} className="border-t text-muted-foreground">
                          <td className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={included}
                              onChange={() => toggleExcluded(r.importGuid)}
                              aria-label={`Include row from ${r.occurredAt}`}
                            />
                          </td>
                          <td className="px-2 py-1 font-mono">{r.occurredAt}</td>
                          <td className="px-2 py-1 font-mono">{(Number(r.odometerDkm) / 10).toFixed(1)}</td>
                          <td className="px-2 py-1 font-mono">{r.fuelQuantityMl.toString()}</td>
                          <td className="px-2 py-1 font-mono">
                            {r.totalCostMinor !== null
                              ? `${r.currency} ${(Number(r.totalCostMinor) / 100).toFixed(2)}`
                              : "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {duplicateRows.length > 0 && (
            <div className="border rounded-md p-3 space-y-2 bg-muted/20">
              <p className="text-sm font-medium">Already imported</p>
              <p className="text-xs text-muted-foreground">
                These entries already exist in your records. They are excluded from this import by default.
                Check a row to include it anyway.
              </p>
              <div className="overflow-x-auto max-h-40 overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="sticky top-0 bg-background">
                      <th className="text-left px-2 py-1 text-muted-foreground w-8">Include</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Date</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Odometer (km)</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Fuel (mL)</th>
                      <th className="text-left px-2 py-1 text-muted-foreground">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateRows.map((r) => {
                      const included = !excludedGuids.has(r.importGuid);
                      return (
                        <tr key={r.sourceRow} className="border-t text-muted-foreground">
                          <td className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={included}
                              onChange={() => toggleExcluded(r.importGuid)}
                              aria-label={`Include row from ${r.occurredAt}`}
                            />
                          </td>
                          <td className="px-2 py-1 font-mono">{r.occurredAt}</td>
                          <td className="px-2 py-1 font-mono">{(Number(r.odometerDkm) / 10).toFixed(1)}</td>
                          <td className="px-2 py-1 font-mono">{r.fuelQuantityMl.toString()}</td>
                          <td className="px-2 py-1 font-mono">
                            {r.totalCostMinor !== null
                              ? `${r.currency} ${(Number(r.totalCostMinor) / 100).toFixed(2)}`
                              : "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {newRows.length > 0 && (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="sticky top-0 bg-background">
                    <th className="text-left px-2 py-1 text-muted-foreground">Date</th>
                    <th className="text-left px-2 py-1 text-muted-foreground">Odometer (km)</th>
                    <th className="text-left px-2 py-1 text-muted-foreground">Fuel (mL)</th>
                    <th className="text-left px-2 py-1 text-muted-foreground">Cost</th>
                    <th className="text-left px-2 py-1 text-muted-foreground">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {newRows.map((r) => (
                    <tr key={r.sourceRow} className="border-t">
                      <td className="px-2 py-1 font-mono">{r.occurredAt}</td>
                      <td className="px-2 py-1 font-mono">{(Number(r.odometerDkm) / 10).toFixed(1)}</td>
                      <td className="px-2 py-1 font-mono">{r.fuelQuantityMl.toString()}</td>
                      <td className="px-2 py-1 font-mono">
                        {r.totalCostMinor !== null
                          ? `${r.currency} ${(Number(r.totalCostMinor) / 100).toFixed(2)}`
                          : "--"}
                      </td>
                      <td className="px-2 py-1">{r.fuelType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invalidRows.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Rows with errors (will not be imported)</p>
              <ul className="text-xs text-muted-foreground space-y-1 max-h-40 overflow-y-auto">
                {invalidRows.map((r) => (
                  <li key={r.sourceRow}>
                    Row {r.sourceRow}: {r.errors.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("map")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button onClick={runImport} disabled={importCount === 0 || isPending}>
              {isPending ? "Importing..." : `Import ${importCount} ${importCount === 1 ? "entry" : "entries"}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // done
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          Import complete
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result && (
          <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <Badge variant="secondary">{result.imported} imported</Badge>
              {result.skipped > 0 && (
                <Badge variant="outline">{result.skipped} skipped</Badge>
              )}
              {result.errors > 0 && (
                <Badge variant="destructive">{result.errors} failed</Badge>
              )}
            </div>
            {result.possibleDuplicates.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Concurrent write conflicts ({result.possibleDuplicates.length})
                </p>
                <p className="text-xs text-muted-foreground">
                  These rows matched an entry that was added between your duplicate check and
                  the import. They were not imported.
                </p>
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="sticky top-0 bg-background">
                        <th className="text-left px-2 py-1 text-muted-foreground">Date</th>
                        <th className="text-left px-2 py-1 text-muted-foreground">Odometer (km)</th>
                        <th className="text-left px-2 py-1 text-muted-foreground">Fuel (mL)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.possibleDuplicates.map((d, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1 font-mono">{d.occurredAt}</td>
                          <td className="px-2 py-1 font-mono">{(d.odometer / 10).toFixed(1)}</td>
                          <td className="px-2 py-1 font-mono">{d.fuelQuantityMl}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        <Button variant="outline" onClick={resetAll}>
          Import another file
        </Button>
      </CardContent>
    </Card>
  );
}
