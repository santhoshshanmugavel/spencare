"use client";

import Link from "next/link";
import { CalendarClock, CreditCard, Landmark, ArrowRight } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/spencare/money";

const CURRENCY = "INR";

function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const due = new Date(isoDate + "T00:00:00Z");
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function DateChip({ isoDate }: { isoDate: string }) {
  const days = daysUntil(isoDate);
  if (days < 0) return <span className="text-xs font-medium text-destructive">Overdue</span>;
  if (days === 0) return <span className="text-xs font-medium text-warning">Today</span>;
  if (days <= 7) return <span className="text-xs text-warning">In {days}d</span>;
  const d = new Date(isoDate + "T00:00:00Z");
  return (
    <span className="text-xs text-muted-foreground">
      {d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}
    </span>
  );
}

export interface UpcomingWidgetItem {
  id: string;
  kind: "commitment" | "loan";
  name: string;
  amountMinor: number;
  currency: string;
  dueDate: string;
  shortfallMinor: number;
}

interface UpcomingWidgetProps {
  items: UpcomingWidgetItem[];
  masked: boolean;
  totalThisMonthMinor: number;
}

export function UpcomingWidget({ items, masked, totalThisMonthMinor }: UpcomingWidgetProps) {
  if (items.length === 0) return null;

  const shown = items.slice(0, 4);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Upcoming</p>
          {totalThisMonthMinor > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(totalThisMonthMinor), CURRENCY)}
                masked={masked}
                size="body"
                className="inline"
              />{" "}
              this month
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/cash-flow/upcoming">
            View all
            <ArrowRight className="size-3.5 ml-1" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {shown.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between px-4 py-3 border-t border-border/50 first:border-t-0"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {item.kind === "commitment" ? (
                <CreditCard className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Landmark className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <DateChip isoDate={item.dueDate} />
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(item.amountMinor), item.currency)}
                masked={masked}
                size="numeric"
              />
              {item.shortfallMinor > 0 && (
                <p className="text-xs text-warning">
                  <Money
                    value={DomainMoney.fromMinorUnits(BigInt(item.shortfallMinor), item.currency)}
                    masked={masked}
                    size="body"
                    className="inline"
                  />{" "}
                  needed
                </p>
              )}
            </div>
          </div>
        ))}
        {items.length > 4 && (
          <div className="px-4 py-3 border-t border-border/50">
            <Link href="/cash-flow/upcoming" className="text-sm text-muted-foreground hover:text-foreground">
              +{items.length - 4} more
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
