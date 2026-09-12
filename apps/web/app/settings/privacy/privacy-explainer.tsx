"use client";

import { Wallet, LineChart, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";

/**
 * The Settings > Privacy explanation surface (Phase 32, Part 4 of the
 * mandate). Progressive disclosure means SHORT, scannable sections here,
 * not a wall of text the user has to read to understand a boolean --
 * each section is one line naming what's affected, not a paragraph of
 * documentation. The three sections mirror the mandate's own three
 * examples exactly (Financial amounts / Charts / Spensa) because they
 * cover the three genuinely distinct redaction surfaces the product
 * actually has (`<Money masked>`, chart suppression, AI text redaction)
 * -- not padded to look complete.
 */
export function PrivacyExplainer({ initialEnabled }: { initialEnabled: boolean }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 py-5">
          <div>
            <h2 className="font-medium text-foreground">Privacy Mode</h2>
            <p className="text-sm text-muted-foreground">
              Privacy Mode hides financial amounts while you&apos;re using Spencare, so people nearby can&apos;t
              easily see sensitive numbers.
            </p>
          </div>
          <PrivacyModeToggle initialEnabled={initialEnabled} variant="settings" />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">What&apos;s affected</h2>

        <div className="space-y-2">
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Wallet className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Financial amounts</p>
              <p className="text-sm text-muted-foreground">
                Safe to Spend, balances, transactions, budgets, and goals are hidden across Home, Cash Flow,
                Goals, and Accounts.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <LineChart className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Charts</p>
              <p className="text-sm text-muted-foreground">
                Financial charts are hidden rather than shown with sensitive values -- never a chart with real
                numbers hiding in a tooltip or label.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Spensa</p>
              <p className="text-sm text-muted-foreground">
                Spensa&apos;s responses are protected from exposing exact financial amounts while Privacy Mode is
                on.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
