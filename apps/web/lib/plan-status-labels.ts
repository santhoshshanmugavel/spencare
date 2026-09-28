import type { PlanItemStatus, PlanStatus } from "@spencare/domain-core";

/**
 * Display labels for Gate 1's locked PlanStatus/PlanItemStatus enums.
 * Never re-derives or re-validates the transition graph itself — that
 * stays exclusively in `@spencare/domain-core` (`isValidPlanStatusTransition`
 * / `isValidPlanItemStatusTransition`). This file only maps a status value
 * already known to be valid to the string the UI shows.
 */

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  postponed: "Postponed",
  completed: "Completed",
  archived: "Archived",
};

export const PLAN_ITEM_STATUS_LABELS: Record<PlanItemStatus, string> = {
  suggested: "Suggested",
  planned: "Planned",
  booked: "Booked",
  committed: "Committed",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
  skipped: "Skipped",
};
