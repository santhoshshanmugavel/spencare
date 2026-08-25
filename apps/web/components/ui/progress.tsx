"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * `tone` is the shared traffic-light status system (design-tokens.md:
 * "the same red/amber/green traffic-light system is reused consistently
 * across ... Budget category progress, Credit-card utilization, and Bill
 * due-status"). Omit it to keep the plain brand-colored bar (e.g. the
 * onboarding step indicator, which isn't a status fill).
 */
export type ProgressTone = "success" | "warning" | "danger"

const TONE_CLASSES: Record<ProgressTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
}

function Progress({
  className,
  value,
  tone,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { tone?: ProgressTone }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("size-full flex-1 transition-all", tone ? TONE_CLASSES[tone] : "bg-primary")}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
