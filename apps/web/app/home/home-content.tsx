"use client";

import Link from "next/link";
import { Landmark, PiggyBank, Target } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { SafeToSpendState } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/spencare/money";

/**
 * Plain-data mirror of `SafeToSpendResult`, matching the Phase 13 pattern
 * established in `cash-flow/cash-flow-overview.tsx` -- `Money` class
 * instances carry a `toJSON` method that crashes the Next.js Server->Client
 * boundary, so the server page converts to this shape and this component
 * reconstructs a `Money` from the plain minor-unit number itself. This is
 * a NEW boundary crossing (home/page.tsx never called `getSafeToSpend`
 * before), so the fix must be applied here from the start rather than
 * discovered live a second time.
 */
export interface SafeToSpendPlain {
  state: SafeToSpendState;
  amountMinor: number;
  currency: string;
}

/**
 * <HomeContent> -- DD-01 (approved): the one net-new Home element, a
 * persistent Safe-to-Spend header, plus SP-051's setup-nudge grid for
 * whichever of {accounts, budget, goals} the user hasn't set up yet.
 * Deliberately narrow per the locked Phase 14 scope: no Net Worth, no
 * Income vs Expenses, no Recent Transactions, no Accounts/Goals/Bills
 * duplication -- information-architecture.md's resolution is that those
 * already live on their own dedicated screens and must not be repeated
 * here.
 */
export function HomeContent({
  displayName,
  safeToSpend,
  masked,
  hasAccounts,
  hasBudget,
  hasGoals,
}: {
  displayName: string | null;
  safeToSpend: SafeToSpendPlain;
  masked: boolean;
  hasAccounts: boolean;
  hasBudget: boolean;
  hasGoals: boolean;
}) {
  const setupIncomplete = !hasAccounts || !hasBudget || !hasGoals;

  return (
    <div className="space-y-6">
      {/*
        Persistent Safe-to-Spend header (DD-01, approved) -- the single
        net-new UI element for this phase. "no_accounts" is rendered
        honestly (system-model.md §25 / api-architecture.md §8.4: never
        fabricate a value when prerequisites are unavailable) rather than
        showing a misleading ₹0.00. `size="hero"` is already the
        design-tokens.md token reserved for exactly this figure
        (information-architecture.md §4: "must be visibly the largest
        financial figure on its screen").
      */}
      <Card>
        <CardContent className="space-y-1 py-6">
          {safeToSpend.state === "no_accounts" ? (
            <>
              <span className="text-sm font-medium text-muted-foreground">Safe to Spend</span>
              <p className="text-lg text-muted-foreground">
                Add an account to see how much you can safely spend.
              </p>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-muted-foreground">
                {safeToSpend.state === "balance_only" ? "Available Balance" : "Safe to Spend"}
              </span>
              <div>
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(safeToSpend.amountMinor), safeToSpend.currency as never)}
                  masked={masked}
                  size="hero"
                  tone="auto"
                  className="text-5xl"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <h1 className="text-2xl font-semibold text-foreground">
        Welcome{displayName ? `, ${displayName}` : ""}
      </h1>

      {/*
        SP-051 setup-nudge grid (approved) -- "Connect AI Model" excluded
        per this phase's explicit scope (BYO AI is a later phase). Each
        card links to its already-existing, already-built route; no new
        account/budget/goal functionality is created here. Cards for
        already-completed steps are omitted rather than shown as inert
        "done" tiles -- SP-051 itself only ever shows the incomplete-setup
        state, so there's no source evidence for what a partially-done
        grid should look like; omitting completed items is the smallest,
        most honest reading (RECOMMENDED, not literally source-evidenced).
      */}
      {setupIncomplete ? (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Complete your setup</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {!hasAccounts ? (
              <Card size="sm">
                <CardContent className="flex flex-col items-start gap-3">
                  <Landmark className="size-6 text-primary" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Set up accounts</p>
                    <p className="text-sm text-muted-foreground">Link a bank, cash, or credit account.</p>
                  </div>
                  <Button asChild size="touch" variant="outline" className="w-full">
                    <Link href="/settings/accounts">Set up accounts</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {!hasBudget ? (
              <Card size="sm">
                <CardContent className="flex flex-col items-start gap-3">
                  <PiggyBank className="size-6 text-primary" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Create a budget</p>
                    <p className="text-sm text-muted-foreground">Set spending limits by category.</p>
                  </div>
                  <Button asChild size="touch" variant="outline" className="w-full">
                    <Link href="/cash-flow/budgets">Create a budget</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {!hasGoals ? (
              <Card size="sm">
                <CardContent className="flex flex-col items-start gap-3">
                  <Target className="size-6 text-primary" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Set a goal</p>
                    <p className="text-sm text-muted-foreground">Save toward something specific.</p>
                  </div>
                  <Button asChild size="touch" variant="outline" className="w-full">
                    <Link href="/goals">Set a goal</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
