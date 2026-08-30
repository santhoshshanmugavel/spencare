"use client";

import Link from "next/link";
import { Landmark, PiggyBank, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  SafeToSpendHeroCard,
  FinancialLayersCard,
  type SafeToSpendPlain,
  type NetWorthPlain,
} from "@/components/spencare/financial-overview-cards";

export type { SafeToSpendPlain, NetWorthPlain };

/**
 * <HomeContent> -- DD-01 (approved): the one net-new Home element, a
 * persistent Safe-to-Spend header, plus SP-051's setup-nudge grid for
 * whichever of {accounts, budget, goals} the user hasn't set up yet.
 *
 * Phase 29 Section 7/29/39 revisits the Phase 14 "deliberately narrow, no
 * Net Worth" locked decision: the current, explicit product direction is
 * that Home must present the SAME financial layers Cash Flow does ("does
 * Home match Cash Flow?" must be yes), using the exact same shared
 * `<SafeToSpendHeroCard>`/`<FinancialLayersCard>` components and data
 * shapes -- not a second, hand-maintained copy of that UI.
 */
export function HomeContent({
  displayName,
  safeToSpend,
  netWorth,
  investmentTotalMinor,
  masked,
  hasAccounts,
  hasBudget,
  hasGoals,
}: {
  displayName: string | null;
  safeToSpend: SafeToSpendPlain;
  netWorth: NetWorthPlain;
  investmentTotalMinor: number;
  masked: boolean;
  hasAccounts: boolean;
  hasBudget: boolean;
  hasGoals: boolean;
}) {
  const setupIncomplete = !hasAccounts || !hasBudget || !hasGoals;

  return (
    <div className="space-y-6">
      <SafeToSpendHeroCard safeToSpend={safeToSpend} masked={masked} heroClassName="text-3xl min-[375px]:text-4xl sm:text-5xl" />
      <FinancialLayersCard
        creditAvailableMinor={safeToSpend.creditAvailableMinor}
        investmentTotalMinor={investmentTotalMinor}
        netWorth={netWorth}
        masked={masked}
      />

      <h1 className="text-2xl font-semibold text-foreground">
        Welcome{displayName ? `, ${displayName}` : ""}
      </h1>

      {/*
        Phase 16 locked decision #2: Home is Spensa's launcher/entry
        surface -- Spensa is never embedded directly into Home, only
        linked to from it. Always visible (not gated behind setup
        completion), since asking Spensa a question doesn't require
        accounts/budget/goals to already exist.
      */}
      <Card>
        <CardContent className="flex items-center gap-4 py-5">
          <Sparkles className="size-6 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex-1 space-y-0.5">
            <p className="font-medium text-foreground">Ask Spensa</p>
            <p className="text-sm text-muted-foreground">
              Ask about your Safe-to-Spend, budgets, goals, or bills.
            </p>
          </div>
          <Button asChild size="touch" variant="outline">
            <Link href="/spensa/new">Chat</Link>
          </Button>
        </CardContent>
      </Card>

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
