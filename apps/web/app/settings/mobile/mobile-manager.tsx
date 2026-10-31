"use client";

import { useState } from "react";
import { Smartphone, Wifi, WifiOff, Trash2 } from "lucide-react";
import type { DeviceRegistrationRow } from "@spencare/domain-application";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/spencare/confirm-dialog";
import { toastConfirmed, toastError } from "@/lib/toast";
import { revokeDeviceRegistrationAction } from "../actions";

interface Props {
  initialDevices: DeviceRegistrationRow[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function isRecentlyActive(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 7 * 24 * 60 * 60 * 1000;
}

export function MobileManager({ initialDevices }: Props) {
  const [devices, setDevices] = useState<DeviceRegistrationRow[]>(initialDevices);
  const [revokeTarget, setRevokeTarget] = useState<DeviceRegistrationRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const result = await revokeDeviceRegistrationAction(revokeTarget.id);
      if (result.ok) {
        setDevices((prev) => prev.filter((d) => d.id !== revokeTarget.id));
        toastConfirmed("Device disconnected.");
      } else {
        toastError("Failed to disconnect device.");
      }
    } catch {
      toastError("Failed to disconnect device.");
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Setup instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Set up the Android app</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Install the Spencare app on your Android device (APK from your administrator, or Play Store when available).</li>
            <li>Open the app and sign in with your Spencare account credentials.</li>
            <li>Tap <strong className="text-foreground">Open Notification Access Settings</strong> and grant Spencare access to notifications.</li>
            <li>The app will register this device automatically and begin capturing financial notifications.</li>
            <li>Captured transactions appear in <strong className="text-foreground">Cash Flow → Transactions</strong> for your review.</li>
          </ol>
          <p className="text-xs">
            The app only reads notification text from known banking apps. No notification content is stored — only the extracted
            financial details (amount, merchant, direction) are sent to Spencare.
          </p>
        </CardContent>
      </Card>

      {/* Connected devices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected devices</CardTitle>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No devices connected yet. Install the Android app and sign in to connect a device.
            </p>
          ) : (
            <ul className="divide-y">
              {devices.map((device) => {
                const active = isRecentlyActive(device.last_seen_at);
                return (
                  <li key={device.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0 rounded-full bg-muted p-2">
                        <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{device.device_name}</span>
                          {device.notification_access_granted ? (
                            <Badge variant="outline" className="text-xs gap-1 shrink-0">
                              <Wifi className="h-3 w-3" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs gap-1 shrink-0 text-muted-foreground">
                              <WifiOff className="h-3 w-3" />
                              No access
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {active ? "Last seen " : "Last seen "}
                          {formatDate(device.last_seen_at)}
                          {" · Connected "}
                          {formatDate(device.created_at)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setRevokeTarget(device)}
                      aria-label={`Disconnect ${device.device_name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {revokeTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
          title="Disconnect device?"
          description={`"${revokeTarget.device_name}" will no longer be able to send captured transactions to Spencare. You can reconnect it at any time by opening the app and signing in again.`}
          confirmLabel={revoking ? "Disconnecting…" : "Disconnect"}
          confirmDisabled={revoking}
          onConfirm={handleRevoke}
        />
      )}
    </div>
  );
}
