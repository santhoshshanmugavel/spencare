/**
 * Spensa notification message composer.
 *
 * Rules decide WHEN something matters.
 * Spensa decides HOW to explain it.
 *
 * All financial values passed to this module are pre-calculated by the
 * deterministic domain layer. This module only decides phrasing — never
 * financial truth. It uses high-quality templates that match Spensa's
 * voice: calm, human, contextual, non-robotic. No em dashes.
 *
 * Guidelines enforced here:
 * - No "Your budget utilization has reached X%" (banking alert language)
 * - No "As your financial assistant..." / "Based on the information..."
 * - No over-celebration of routine events
 * - Amounts shown in major currency units (₹500 not ₹50000 minor)
 * - Uses "you" not "the user"
 * - Short. One or two sentences max.
 */

export type NotificationEventType =
  | "BUDGET_50" | "BUDGET_80" | "BUDGET_90" | "BUDGET_100" | "BUDGET_OVER"
  | "BALANCE_LOW" | "BALANCE_ZERO" | "BALANCE_NEGATIVE"
  | "CREDIT_50" | "CREDIT_80" | "CREDIT_90" | "CREDIT_100"
  | "GOAL_CONTRIBUTION" | "GOAL_25" | "GOAL_50" | "GOAL_75" | "GOAL_90" | "GOAL_COMPLETED"
  | "GOAL_PLAN_UPCOMING" | "GOAL_PLAN_DUE" | "GOAL_PLAN_MISSED"
  | "BILL_7_DAYS" | "BILL_3_DAYS" | "BILL_1_DAY" | "BILL_DUE_TODAY" | "BILL_OVERDUE" | "BILL_AMOUNT_CHANGED"
  | "COMMITMENT_7_DAYS" | "COMMITMENT_3_DAYS" | "COMMITMENT_1_DAY" | "COMMITMENT_DUE_TODAY" | "COMMITMENT_OVERDUE" | "COMMITMENT_SHORTFALL"
  | "COMMITMENT_AUTO_PAID" | "COMMITMENT_AUTO_PAY_FAILED" | "COMMITMENT_AUTO_PROTECTED" | "COMMITMENT_PREPARATION"
  | "LOAN_7_DAYS" | "LOAN_3_DAYS" | "LOAN_1_DAY" | "LOAN_DUE_TODAY" | "LOAN_OVERDUE"
  | "CC_STATEMENT_7_DAYS" | "CC_STATEMENT_TODAY"
  | "CC_PAYMENT_7_DAYS" | "CC_PAYMENT_3_DAYS" | "CC_PAYMENT_1_DAY" | "CC_PAYMENT_TODAY" | "CC_PAYMENT_OVERDUE"
  | "PLAN_ITEM_7_DAYS" | "PLAN_ITEM_3_DAYS" | "PLAN_ITEM_1_DAY" | "PLAN_ITEM_DUE_TODAY" | "PLAN_ITEM_OVERDUE"
  | "PLAN_BUDGET_80" | "PLAN_BUDGET_OVER" | "PLAN_COMPLETED"
  | "TRANSACTION_LARGE" | "TRANSACTION_UNUSUAL"
  | "SECURITY_PASSWORD_CHANGED" | "SECURITY_NEW_LOGIN" | "SECURITY_2FA_CHANGED"
  | "GMAIL_CONNECTED" | "GMAIL_CONNECTION_ERROR" | "MCP_CONNECTED" | "MCP_REVOKED"
  | "WEEKLY_SUMMARY" | "MONTHLY_SUMMARY" | "DAILY_SUMMARY";

export interface NotificationMessage {
  title: string;
  body: string;
  /** Optional richer body used only for Telegram; falls back to `body` if absent. */
  telegramBody?: string;
}

export interface ComposeOptions {
  /**
   * When true, financial notifications are rendered with a privacy-safe
   * variant that masks amounts and entity names. Security + integration
   * events are never masked -- they must stay actionable regardless of
   * privacy mode. See `isFinanciallySensitiveEvent` below.
   *
   * The caller (notification delivery engine) is responsible for reading
   * `profiles.privacy_mode_enabled` and passing it in. Templates NEVER
   * reach for the profile themselves -- the decision is centralized here
   * (Spec Phase 0.1).
   */
  privacyMode?: boolean;
}

function fmt(amountMinor: number, currency = "INR"): string {
  const major = amountMinor / 100;
  if (currency === "INR") {
    return `₹${major.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }
  return `${major.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`;
}

function daysLabel(days: number): string {
  if (days === 1) return "tomorrow";
  if (days === 0) return "today";
  return `in ${days} days`;
}

/**
 * Events whose message must stay actionable even in Privacy Mode (Spec
 * Phase 0.2 "amounts, balances, spending, goal/commitment/plan/loan/CC
 * amounts" are masked; security + integration + summary categories are
 * not financial-value disclosures). The engine still delivers everything
 * -- the choice is only whether to swap in the privacy-safe template.
 */
const NEVER_MASKED_EVENTS: ReadonlySet<NotificationEventType> = new Set([
  "SECURITY_PASSWORD_CHANGED",
  "SECURITY_NEW_LOGIN",
  "SECURITY_2FA_CHANGED",
  "GMAIL_CONNECTED",
  "GMAIL_CONNECTION_ERROR",
  "MCP_CONNECTED",
  "MCP_REVOKED",
]);

export function isFinanciallySensitiveEvent(eventType: NotificationEventType): boolean {
  return !NEVER_MASKED_EVENTS.has(eventType);
}

/**
 * Appends a short "Part of your X plan" clause when the rule layer attached
 * Plan context to an otherwise unrelated Commitment, Goal, or Account event
 * (Gate 9, mirroring Gate 8's read-only Plan-context composition). This
 * never changes which event fired or the financial values already in the
 * message -- it only adds context about which Plan the underlying entity
 * belongs to.
 */
function planContextSuffix(planNames: string[] | undefined): string {
  if (!planNames || planNames.length === 0) return "";
  if (planNames.length === 1) return ` Part of your ${planNames[0]} plan.`;
  const last = planNames[planNames.length - 1];
  const rest = planNames.slice(0, -1).join(", ");
  return ` Part of your ${rest} and ${last} plans.`;
}

export function composeNotificationMessage(
  eventType: NotificationEventType,
  context: Record<string, unknown>,
  options?: ComposeOptions,
): NotificationMessage {
  // Centralized privacy decision (Spec Phase 0.1): if privacy is on AND
  // this event discloses financial values, swap in the privacy-safe
  // template BEFORE any channel-specific formatting runs. This way the
  // same stripped payload reaches in-app + Telegram, and templates below
  // never need to remember to check privacyMode themselves.
  if (options?.privacyMode && isFinanciallySensitiveEvent(eventType)) {
    return composePrivateMessage(eventType);
  }

  const message = composeCore(eventType, context);
  const suffix = planContextSuffix(context.planNames as string[] | undefined);
  if (!suffix) return message;
  return {
    ...message,
    body: message.body + suffix,
    telegramBody: (message.telegramBody ?? message.body) + suffix,
  };
}

/**
 * Privacy-safe templates. One short, context-preserving line per event
 * category, with no amounts and no entity names (goal/commitment/account/
 * bill names). Matches the Spec Phase 0.3 example:
 *
 *   Detailed:  "₹20,000 added to Emergency Fund."
 *   Private:   "Goal contribution recorded."
 *
 * These are not just the detailed messages minus the numbers -- they are
 * deliberately short, so the recipient knows a thing happened and can
 * open Spencare to read details, but no sensitive financial content is
 * exposed in a notification shade or Telegram chat preview.
 *
 * `telegramBody` is intentionally identical to `body` here -- there is
 * nothing extra to say in Telegram when the point is to say less.
 */
function composePrivateMessage(eventType: NotificationEventType): NotificationMessage {
  switch (eventType) {
    // ---- Budget ----
    case "BUDGET_50":
    case "BUDGET_80":
    case "BUDGET_90":
    case "BUDGET_100":
    case "BUDGET_OVER":
      return { title: "Budget update", body: "There's an update on one of your budgets." };

    // ---- Balance ----
    case "BALANCE_LOW":
    case "BALANCE_ZERO":
    case "BALANCE_NEGATIVE":
      return { title: "Account balance alert", body: "One of your accounts needs attention." };

    // ---- Credit utilization ----
    case "CREDIT_50":
    case "CREDIT_80":
    case "CREDIT_90":
    case "CREDIT_100":
      return { title: "Credit utilization alert", body: "A credit card is approaching its limit." };

    // ---- Goal ----
    case "GOAL_CONTRIBUTION":
      return { title: "Goal contribution recorded", body: "A contribution was added to a goal." };
    case "GOAL_25":
    case "GOAL_50":
    case "GOAL_75":
    case "GOAL_90":
      return { title: "Goal progress", body: "One of your goals made progress." };
    case "GOAL_COMPLETED":
      return { title: "Goal complete", body: "One of your goals reached its target." };
    case "GOAL_PLAN_UPCOMING":
    case "GOAL_PLAN_DUE":
      return { title: "Goal contribution reminder", body: "A planned goal contribution is coming up." };
    case "GOAL_PLAN_MISSED":
      return { title: "Goal contribution overdue", body: "A planned goal contribution is overdue." };

    // ---- Bills ----
    case "BILL_7_DAYS":
    case "BILL_3_DAYS":
    case "BILL_1_DAY":
    case "BILL_DUE_TODAY":
      return { title: "Bill reminder", body: "An upcoming bill is on the way." };
    case "BILL_OVERDUE":
      return { title: "Bill may be overdue", body: "A bill was expected and hasn't been recorded." };
    case "BILL_AMOUNT_CHANGED":
      return { title: "Bill updated", body: "The expected amount on a bill changed." };

    // ---- Commitments ----
    case "COMMITMENT_7_DAYS":
    case "COMMITMENT_3_DAYS":
    case "COMMITMENT_1_DAY":
    case "COMMITMENT_DUE_TODAY":
      return { title: "Commitment reminder", body: "An upcoming commitment is on the way." };
    case "COMMITMENT_OVERDUE":
      return { title: "Commitment overdue", body: "A commitment is overdue." };
    case "COMMITMENT_SHORTFALL":
      return { title: "Commitment needs more saved", body: "A commitment still needs funding." };
    case "COMMITMENT_AUTO_PAID":
      return { title: "Commitment payment recorded", body: "A commitment payment was auto-recorded." };
    case "COMMITMENT_AUTO_PAY_FAILED":
      return { title: "Commitment auto-record failed", body: "A commitment payment could not be recorded automatically." };
    case "COMMITMENT_AUTO_PROTECTED":
      return { title: "Commitment funds protected", body: "Spencare automatically protected funds for a commitment." };
    case "COMMITMENT_PREPARATION":
      return { title: "Commitment preparation reminder", body: "Time to set aside funds for an upcoming commitment." };

    // ---- Loans ----
    case "LOAN_7_DAYS":
    case "LOAN_3_DAYS":
    case "LOAN_1_DAY":
    case "LOAN_DUE_TODAY":
      return { title: "Loan payment reminder", body: "A loan installment is coming up." };
    case "LOAN_OVERDUE":
      return { title: "Loan payment overdue", body: "A loan installment is overdue." };

    // ---- Credit card billing ----
    case "CC_STATEMENT_7_DAYS":
    case "CC_STATEMENT_TODAY":
      return { title: "Credit card statement update", body: "A credit card statement is being generated." };
    case "CC_PAYMENT_7_DAYS":
    case "CC_PAYMENT_3_DAYS":
    case "CC_PAYMENT_1_DAY":
    case "CC_PAYMENT_TODAY":
      return { title: "Credit card payment reminder", body: "A credit card payment is coming up." };
    case "CC_PAYMENT_OVERDUE":
      return { title: "Credit card payment overdue", body: "A credit card payment is overdue." };

    // ---- Plan items ----
    case "PLAN_ITEM_7_DAYS":
    case "PLAN_ITEM_3_DAYS":
    case "PLAN_ITEM_1_DAY":
    case "PLAN_ITEM_DUE_TODAY":
      return { title: "Plan item reminder", body: "A planned item is coming up." };
    case "PLAN_ITEM_OVERDUE":
      return { title: "Plan item may be overdue", body: "A planned item was expected and hasn't been recorded." };

    // ---- Plan budget ----
    case "PLAN_BUDGET_80":
    case "PLAN_BUDGET_OVER":
      return { title: "Plan budget update", body: "There's an update on one of your plan budgets." };
    case "PLAN_COMPLETED":
      return { title: "Plan complete", body: "You completed one of your plans." };

    // ---- Transactions ----
    case "TRANSACTION_LARGE":
      return { title: "Large transaction recorded", body: "A transaction worth reviewing was added." };
    case "TRANSACTION_UNUSUAL":
      return { title: "Unusual transaction", body: "A transaction outside your normal patterns was recorded." };

    // ---- Summaries ----
    case "DAILY_SUMMARY":
      return { title: "Your daily summary", body: "Your daily summary is ready in Spencare." };
    case "WEEKLY_SUMMARY":
      return { title: "Your weekly summary", body: "Your weekly summary is ready in Spencare." };
    case "MONTHLY_SUMMARY":
      return { title: "Your monthly summary", body: "Your monthly summary is ready in Spencare." };

    // ---- Security / integration events: never reach here (bypassed by
    // ---- isFinanciallySensitiveEvent). Fall through to a safe default
    // ---- so a future financial event forgetting its branch degrades
    // ---- safely instead of leaking context.
    default:
      return { title: "Spencare update", body: "Something worth knowing happened in your account." };
  }
}

function composeCore(
  eventType: NotificationEventType,
  context: Record<string, unknown>,
): NotificationMessage {
  const c = context;
  const currency = (c.currency as string) ?? "INR";

  switch (eventType) {
    // ---- Budget alerts ----
    case "BUDGET_50": {
      const { budgetName, spentMinor, limitMinor, daysLeft } = c as {
        budgetName: string; spentMinor: number; limitMinor: number; daysLeft: number;
      };
      return {
        title: `${budgetName} budget at halfway`,
        body: `You've used ${fmt(spentMinor, currency)} of your ${fmt(limitMinor, currency)} ${budgetName} budget, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month.`,
      };
    }
    case "BUDGET_80": {
      const { budgetName, spentMinor, limitMinor, daysLeft } = c as {
        budgetName: string; spentMinor: number; limitMinor: number; daysLeft: number;
      };
      return {
        title: `${budgetName} budget getting close`,
        body: `You've used ${fmt(spentMinor, currency)} of your ${fmt(limitMinor, currency)} ${budgetName} budget. ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`,
      };
    }
    case "BUDGET_90": {
      const { budgetName, remainingMinor, daysLeft } = c as {
        budgetName: string; remainingMinor: number; daysLeft: number;
      };
      return {
        title: `${budgetName} budget almost gone`,
        body: `Only ${fmt(remainingMinor, currency)} left in your ${budgetName} budget, and you still have ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go.`,
      };
    }
    case "BUDGET_100": {
      const { budgetName, daysLeft } = c as { budgetName: string; daysLeft: number };
      return {
        title: `${budgetName} budget reached`,
        body: `You've hit your ${budgetName} budget limit. ${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining this month.`,
      };
    }
    case "BUDGET_OVER": {
      const { budgetName, overByMinor } = c as { budgetName: string; overByMinor: number };
      return {
        title: `${budgetName} budget exceeded`,
        body: `Your ${budgetName} spending is ${fmt(overByMinor, currency)} over the limit this month.`,
      };
    }

    // ---- Balance alerts ----
    case "BALANCE_LOW": {
      const { accountName, balanceMinor } = c as { accountName: string; balanceMinor: number };
      return {
        title: `${accountName} balance is low`,
        body: `Your ${accountName} balance is down to ${fmt(balanceMinor, currency)}.`,
      };
    }
    case "BALANCE_ZERO": {
      const { accountName } = c as { accountName: string };
      return {
        title: `${accountName} is at zero`,
        body: `Your ${accountName} account has reached zero. Any upcoming transactions may not go through.`,
      };
    }
    case "BALANCE_NEGATIVE": {
      const { accountName, balanceMinor } = c as { accountName: string; balanceMinor: number };
      return {
        title: `${accountName} balance is negative`,
        body: `Your ${accountName} account is ${fmt(Math.abs(balanceMinor), currency)} in the negative.`,
      };
    }

    // ---- Credit utilization ----
    case "CREDIT_50": {
      const { accountName, utilizationPct, usedMinor, limitMinor } = c as {
        accountName: string; utilizationPct: number; usedMinor: number; limitMinor: number;
      };
      return {
        title: `${accountName} at ${utilizationPct}% utilization`,
        body: `You've used ${fmt(usedMinor, currency)} of your ${fmt(limitMinor, currency)} ${accountName} limit.`,
      };
    }
    case "CREDIT_80": {
      const { accountName, utilizationPct, remainingMinor } = c as {
        accountName: string; utilizationPct: number; remainingMinor: number;
      };
      return {
        title: `${accountName} credit getting tight`,
        body: `${accountName} is at ${utilizationPct}% utilization. ${fmt(remainingMinor, currency)} remaining.`,
      };
    }
    case "CREDIT_90": {
      const { accountName, utilizationPct, remainingMinor } = c as {
        accountName: string; utilizationPct: number; remainingMinor: number;
      };
      return {
        title: `${accountName} almost at limit`,
        body: `${accountName} is ${utilizationPct}% used. Only ${fmt(remainingMinor, currency)} left on the card.`,
      };
    }
    case "CREDIT_100": {
      const { accountName } = c as { accountName: string };
      return {
        title: `${accountName} credit limit reached`,
        body: `Your ${accountName} card has hit its credit limit.`,
      };
    }

    // ---- Goal events ----
    case "GOAL_CONTRIBUTION": {
      const { goalName, contributionMinor, progressPct } = c as {
        goalName: string; contributionMinor: number; progressPct: number;
      };
      return {
        title: `${goalName} progress`,
        body: `${fmt(contributionMinor, currency)} added to ${goalName}. You're now ${progressPct}% of the way there.`,
      };
    }
    case "GOAL_25": {
      const { goalName, savedMinor, targetMinor } = c as {
        goalName: string; savedMinor: number; targetMinor: number;
      };
      return {
        title: `${goalName} at 25%`,
        body: `${fmt(savedMinor, currency)} saved toward ${goalName}. ${fmt(targetMinor - savedMinor, currency)} to go.`,
      };
    }
    case "GOAL_50": {
      const { goalName, savedMinor, targetMinor } = c as {
        goalName: string; savedMinor: number; targetMinor: number;
      };
      return {
        title: `Halfway to ${goalName}`,
        body: `You're at the halfway point for ${goalName}. ${fmt(targetMinor - savedMinor, currency)} left to reach the target.`,
      };
    }
    case "GOAL_75": {
      const { goalName, savedMinor, targetMinor } = c as {
        goalName: string; savedMinor: number; targetMinor: number;
      };
      return {
        title: `${goalName} at 75%`,
        body: `Three quarters of the way to ${goalName}. ${fmt(targetMinor - savedMinor, currency)} remaining.`,
      };
    }
    case "GOAL_90": {
      const { goalName, remainingMinor } = c as { goalName: string; remainingMinor: number };
      return {
        title: `${goalName} is almost there`,
        body: `Only ${fmt(remainingMinor, currency)} more and ${goalName} is complete.`,
      };
    }
    case "GOAL_COMPLETED": {
      const { goalName, targetMinor } = c as { goalName: string; targetMinor: number };
      return {
        title: `${goalName} complete`,
        body: `You made it. ${goalName} has reached its ${fmt(targetMinor, currency)} target.`,
      };
    }

    // ---- Goal contribution plan reminders ----
    case "GOAL_PLAN_UPCOMING": {
      const { goalName, amountMinor, frequencyLabel } = c as {
        goalName: string; amountMinor: number; frequencyLabel: string;
      };
      return {
        title: `${goalName} contribution coming up`,
        body: `Your ${frequencyLabel.toLowerCase()} ${fmt(amountMinor, currency)} contribution for ${goalName} is due in 3 days. Head to Goals to record it.`,
      };
    }
    case "GOAL_PLAN_DUE": {
      const { goalName, amountMinor } = c as { goalName: string; amountMinor: number };
      return {
        title: `Time to save for ${goalName}`,
        body: `Today's the day for your ${fmt(amountMinor, currency)} contribution to ${goalName}. Record it in Goals when you're ready.`,
      };
    }
    case "GOAL_PLAN_MISSED": {
      const { goalName, amountMinor, daysOverdue } = c as {
        goalName: string; amountMinor: number; daysOverdue: number;
      };
      return {
        title: `${goalName} contribution is overdue`,
        body: `Your planned ${fmt(amountMinor, currency)} contribution for ${goalName} is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue. You can still record it whenever you're ready.`,
      };
    }

    // ---- Bill reminders ----
    case "BILL_7_DAYS": {
      const { billName, expectedAmountMinor } = c as { billName: string; expectedAmountMinor: number | null };
      const amountPart = expectedAmountMinor ? ` (${fmt(expectedAmountMinor, currency)})` : "";
      return {
        title: `${billName} due in 7 days`,
        body: `Your ${billName} payment${amountPart} is expected next week.`,
      };
    }
    case "BILL_3_DAYS": {
      const { billName, expectedAmountMinor } = c as { billName: string; expectedAmountMinor: number | null };
      const amountPart = expectedAmountMinor ? ` of ${fmt(expectedAmountMinor, currency)}` : "";
      return {
        title: `${billName} due in 3 days`,
        body: `Your ${billName} payment${amountPart} is expected in 3 days.`,
      };
    }
    case "BILL_1_DAY": {
      const { billName, expectedAmountMinor } = c as { billName: string; expectedAmountMinor: number | null };
      const amountPart = expectedAmountMinor ? ` of ${fmt(expectedAmountMinor, currency)}` : "";
      return {
        title: `${billName} due tomorrow`,
        body: `Your ${billName} payment${amountPart} is expected tomorrow.`,
      };
    }
    case "BILL_DUE_TODAY": {
      const { billName, expectedAmountMinor } = c as { billName: string; expectedAmountMinor: number | null };
      const amountPart = expectedAmountMinor ? ` of ${fmt(expectedAmountMinor, currency)}` : "";
      return {
        title: `${billName} due today`,
        body: `Your ${billName} payment${amountPart} is expected today.`,
      };
    }
    case "BILL_OVERDUE": {
      const { billName, daysPast } = c as { billName: string; daysPast: number };
      return {
        title: `${billName} may be overdue`,
        body: `${billName} was expected ${daysPast} day${daysPast === 1 ? "" : "s"} ago and hasn't been recorded yet.`,
      };
    }
    case "BILL_AMOUNT_CHANGED": {
      const { billName, oldAmountMinor, newAmountMinor } = c as {
        billName: string; oldAmountMinor: number; newAmountMinor: number;
      };
      return {
        title: `${billName} amount updated`,
        body: `${billName} was updated from ${fmt(oldAmountMinor, currency)} to ${fmt(newAmountMinor, currency)}.`,
      };
    }

    // ---- Planned commitment reminders ----
    case "COMMITMENT_7_DAYS": {
      const { commitmentName, amountMinor, reservedMinor } = c as {
        commitmentName: string; amountMinor: number; reservedMinor: number;
      };
      const shortfall = amountMinor - reservedMinor;
      const shortfallPart = shortfall > 0 ? ` ${fmt(shortfall, currency)} still needs to be set aside.` : " You're fully reserved.";
      return {
        title: `${commitmentName} due in 7 days`,
        body: `${fmt(amountMinor, currency)} due next week.${shortfallPart}`,
      };
    }
    case "COMMITMENT_3_DAYS": {
      const { commitmentName, amountMinor, reservedMinor } = c as {
        commitmentName: string; amountMinor: number; reservedMinor: number;
      };
      const shortfall = amountMinor - reservedMinor;
      const shortfallPart = shortfall > 0 ? ` ${fmt(shortfall, currency)} still needed.` : " You're covered.";
      return {
        title: `${commitmentName} due in 3 days`,
        body: `${fmt(amountMinor, currency)} due in 3 days.${shortfallPart}`,
      };
    }
    case "COMMITMENT_1_DAY": {
      const { commitmentName, amountMinor, reservedMinor } = c as {
        commitmentName: string; amountMinor: number; reservedMinor: number;
      };
      const shortfall = amountMinor - reservedMinor;
      const shortfallPart = shortfall > 0 ? ` ${fmt(shortfall, currency)} still needed.` : " You're covered.";
      return {
        title: `${commitmentName} due tomorrow`,
        body: `${fmt(amountMinor, currency)} due tomorrow.${shortfallPart}`,
      };
    }
    case "COMMITMENT_DUE_TODAY": {
      const { commitmentName, amountMinor } = c as { commitmentName: string; amountMinor: number };
      return {
        title: `${commitmentName} due today`,
        body: `Your ${commitmentName} payment of ${fmt(amountMinor, currency)} is due today.`,
      };
    }
    case "COMMITMENT_OVERDUE": {
      const { commitmentName, daysPast } = c as { commitmentName: string; daysPast: number };
      return {
        title: `${commitmentName} is overdue`,
        body: `${commitmentName} was due ${daysPast} day${daysPast === 1 ? "" : "s"} ago and hasn't been recorded as paid yet.`,
      };
    }
    case "COMMITMENT_SHORTFALL": {
      const { commitmentName, amountMinor, reservedMinor, dueDateIso } = c as {
        commitmentName: string; amountMinor: number; reservedMinor: number; dueDateIso: string;
      };
      const shortfall = amountMinor - reservedMinor;
      const due = new Date(dueDateIso + "T00:00:00Z");
      const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86400000);
      return {
        title: `${commitmentName} needs more saved`,
        body: `${fmt(shortfall, currency)} still needed for ${commitmentName}, due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
      };
    }

    // ---- Commitment automation results ----
    case "COMMITMENT_AUTO_PAID": {
      const { commitmentName, amountMinor, accountName, nextDueDateIso } = c as {
        commitmentName: string; amountMinor: number; accountName: string; nextDueDateIso: string | null;
      };
      const nextPart = nextDueDateIso
        ? ` Next payment: ${new Date(nextDueDateIso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}.`
        : "";
      return {
        title: `${commitmentName} payment recorded automatically`,
        body: `${fmt(amountMinor, currency)} was recorded via ${accountName}.${nextPart}`,
      };
    }
    case "COMMITMENT_AUTO_PAY_FAILED": {
      const { commitmentName, amountMinor, reason } = c as {
        commitmentName: string; amountMinor: number; reason: string;
      };
      return {
        title: `${commitmentName} auto-record could not complete`,
        body: `The ${fmt(amountMinor, currency)} payment for ${commitmentName} could not be recorded automatically. ${reason}`,
      };
    }
    case "COMMITMENT_AUTO_PROTECTED": {
      const { commitmentName, protectedMinor, totalMinor } = c as {
        commitmentName: string; protectedMinor: number; totalMinor: number;
      };
      return {
        title: `${fmt(protectedMinor, currency)} protected for ${commitmentName}`,
        body: `Spencare automatically protected ${fmt(protectedMinor, currency)} for ${commitmentName}. Total protected: ${fmt(Math.min(totalMinor, protectedMinor), currency)} of ${fmt(totalMinor, currency)}.`,
      };
    }
    case "COMMITMENT_PREPARATION": {
      const { commitmentName, savingAmountMinor, nextPaymentDateIso } = c as {
        commitmentName: string; savingAmountMinor: number; nextPaymentDateIso: string;
      };
      const payDate = new Date(nextPaymentDateIso + "T00:00:00Z");
      const payLabel = payDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
      return {
        title: `Time to set aside money for ${commitmentName}`,
        body: `${fmt(savingAmountMinor, currency)} is planned for ${commitmentName} today. Payment is due ${payLabel}.`,
      };
    }

    // ---- Loan payment reminders ----
    case "LOAN_7_DAYS": {
      const { loanName, installmentMinor } = c as { loanName: string; installmentMinor: number };
      return {
        title: `${loanName} payment due in 7 days`,
        body: `${fmt(installmentMinor, currency)} installment is due next week.`,
      };
    }
    case "LOAN_3_DAYS": {
      const { loanName, installmentMinor } = c as { loanName: string; installmentMinor: number };
      return {
        title: `${loanName} payment due in 3 days`,
        body: `${fmt(installmentMinor, currency)} installment is due in 3 days.`,
      };
    }
    case "LOAN_1_DAY": {
      const { loanName, installmentMinor } = c as { loanName: string; installmentMinor: number };
      return {
        title: `${loanName} payment due tomorrow`,
        body: `Your ${loanName} installment of ${fmt(installmentMinor, currency)} is due tomorrow.`,
      };
    }
    case "LOAN_DUE_TODAY": {
      const { loanName, installmentMinor } = c as { loanName: string; installmentMinor: number };
      return {
        title: `${loanName} payment due today`,
        body: `Your ${loanName} installment of ${fmt(installmentMinor, currency)} is due today.`,
      };
    }
    case "LOAN_OVERDUE": {
      const { loanName, daysPast } = c as { loanName: string; daysPast: number };
      return {
        title: `${loanName} payment overdue`,
        body: `${loanName} installment was due ${daysPast} day${daysPast === 1 ? "" : "s"} ago. Record the payment when done.`,
      };
    }

    // ---- Credit card billing reminders ----
    case "CC_STATEMENT_7_DAYS": {
      const { accountName } = c as { accountName: string };
      return {
        title: `${accountName} statement in 7 days`,
        body: `Your ${accountName} statement will be generated in 7 days. Make sure your recent spending is accounted for.`,
      };
    }
    case "CC_STATEMENT_TODAY": {
      const { accountName, usedMinor } = c as { accountName: string; usedMinor: number };
      return {
        title: `${accountName} statement generated today`,
        body: `Your ${accountName} statement is being cut today. Current outstanding: ${fmt(usedMinor, currency)}.`,
      };
    }
    case "CC_PAYMENT_7_DAYS": {
      const { accountName, outstandingMinor } = c as { accountName: string; outstandingMinor: number };
      return {
        title: `${accountName} payment due in 7 days`,
        body: `Your ${accountName} credit card payment of ${fmt(outstandingMinor, currency)} is due next week.`,
      };
    }
    case "CC_PAYMENT_3_DAYS": {
      const { accountName, outstandingMinor } = c as { accountName: string; outstandingMinor: number };
      return {
        title: `${accountName} payment due in 3 days`,
        body: `${fmt(outstandingMinor, currency)} due on ${accountName} in 3 days. Make the payment to avoid interest.`,
      };
    }
    case "CC_PAYMENT_TODAY": {
      const { accountName, outstandingMinor } = c as { accountName: string; outstandingMinor: number };
      return {
        title: `${accountName} payment due today`,
        body: `Your ${accountName} credit card payment of ${fmt(outstandingMinor, currency)} is due today.`,
      };
    }
    case "CC_PAYMENT_1_DAY": {
      const { accountName, outstandingMinor } = c as { accountName: string; outstandingMinor: number };
      return {
        title: `${accountName} payment due tomorrow`,
        body: `Your ${accountName} credit card payment of ${fmt(outstandingMinor, currency)} is due tomorrow.`,
      };
    }
    case "CC_PAYMENT_OVERDUE": {
      const { accountName, outstandingMinor, daysOverdue } = c as { accountName: string; outstandingMinor: number; daysOverdue: number };
      return {
        title: `${accountName} payment overdue`,
        body: `Your ${accountName} credit card payment of ${fmt(outstandingMinor, currency)} is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`,
      };
    }

    // ---- Plan Item reminders ----
    case "PLAN_ITEM_7_DAYS": {
      const { planName, itemName, amountMinor, isCommitted } = c as {
        planName: string; itemName: string; amountMinor: number | null; isCommitted: boolean;
      };
      const amountPart = amountMinor ? ` of ${fmt(amountMinor, currency)}` : "";
      const statusWord = isCommitted ? "committed" : "planned";
      return {
        title: `${itemName} due in 7 days`,
        body: `Your ${statusWord} ${planName} item${amountPart} is expected in 7 days.`,
      };
    }
    case "PLAN_ITEM_3_DAYS": {
      const { planName, itemName, amountMinor, isCommitted } = c as {
        planName: string; itemName: string; amountMinor: number | null; isCommitted: boolean;
      };
      const amountPart = amountMinor ? ` of ${fmt(amountMinor, currency)}` : "";
      const statusWord = isCommitted ? "committed" : "planned";
      return {
        title: `${itemName} due in 3 days`,
        body: `Your ${statusWord} ${planName} item${amountPart} is expected in 3 days.`,
      };
    }
    case "PLAN_ITEM_1_DAY": {
      const { planName, itemName, amountMinor, isCommitted } = c as {
        planName: string; itemName: string; amountMinor: number | null; isCommitted: boolean;
      };
      const amountPart = amountMinor ? ` of ${fmt(amountMinor, currency)}` : "";
      const statusWord = isCommitted ? "committed" : "planned";
      return {
        title: `${itemName} due tomorrow`,
        body: `Your ${statusWord} ${planName} item${amountPart} is expected tomorrow.`,
      };
    }
    case "PLAN_ITEM_DUE_TODAY": {
      const { planName, itemName, amountMinor, isCommitted } = c as {
        planName: string; itemName: string; amountMinor: number | null; isCommitted: boolean;
      };
      const amountPart = amountMinor ? ` of ${fmt(amountMinor, currency)}` : "";
      const statusWord = isCommitted ? "committed" : "planned";
      return {
        title: `${itemName} due today`,
        body: `Your ${statusWord} ${planName} item${amountPart} is expected today.`,
      };
    }
    case "PLAN_ITEM_OVERDUE": {
      const { planName, itemName, daysPast } = c as { planName: string; itemName: string; daysPast: number };
      return {
        title: `${itemName} may be overdue`,
        body: `${itemName} in your ${planName} plan was expected ${daysPast} day${daysPast === 1 ? "" : "s"} ago and hasn't been recorded yet.`,
      };
    }

    // ---- Plan budget risk ----
    case "PLAN_BUDGET_80": {
      const { planName, actualSpendMinor, budgetMinor } = c as {
        planName: string; actualSpendMinor: number; budgetMinor: number;
      };
      return {
        title: `${planName} budget getting close`,
        body: `You've used ${fmt(actualSpendMinor, currency)} of your ${fmt(budgetMinor, currency)} ${planName} budget.`,
      };
    }
    case "PLAN_BUDGET_OVER": {
      const { planName, overByMinor } = c as { planName: string; overByMinor: number };
      return {
        title: `${planName} budget exceeded`,
        body: `Your ${planName} spending is ${fmt(overByMinor, currency)} over the plan's budget.`,
      };
    }
    case "PLAN_COMPLETED": {
      const { planName } = c as { planName: string };
      return {
        title: `${planName} complete`,
        body: `You completed your ${planName} plan.`,
      };
    }

    // ---- Transaction alerts ----
    case "TRANSACTION_LARGE": {
      const { amountMinor, merchant } = c as { amountMinor: number; merchant: string | null };
      return {
        title: "Large transaction recorded",
        body: `A ${fmt(amountMinor, currency)} expense${merchant ? ` at ${merchant}` : ""} was added. Check that it looks right.`,
      };
    }
    case "TRANSACTION_UNUSUAL": {
      const { amountMinor, categoryName } = c as { amountMinor: number; categoryName: string | null };
      return {
        title: "Unusual transaction",
        body: `A ${fmt(amountMinor, currency)} transaction${categoryName ? ` in ${categoryName}` : ""} looks outside your normal patterns.`,
      };
    }

    // ---- Security notifications ----
    case "SECURITY_PASSWORD_CHANGED": {
      return {
        title: "Password changed",
        body: "Your Spencare password was changed. If this wasn't you, contact support immediately.",
      };
    }
    case "SECURITY_NEW_LOGIN": {
      const { location } = c as { location?: string };
      return {
        title: "New sign-in to Spencare",
        body: `Someone signed in to your account${location ? ` from ${location}` : ""}. If this wasn't you, secure your account now.`,
      };
    }
    case "SECURITY_2FA_CHANGED": {
      return {
        title: "Two-factor authentication changed",
        body: "Your two-factor authentication settings were updated. If this wasn't you, secure your account now.",
      };
    }

    // ---- Integration events ----
    case "GMAIL_CONNECTED": {
      return {
        title: "Gmail connected",
        body: "Spencare will now check your Gmail for financial emails and add them to your review queue.",
      };
    }
    case "GMAIL_CONNECTION_ERROR": {
      return {
        title: "Gmail sync issue",
        body: "There was a problem syncing your Gmail. Go to Settings to reconnect.",
      };
    }
    case "MCP_CONNECTED": {
      const { clientName } = c as { clientName: string };
      return {
        title: `MCP session connected`,
        body: `${clientName} connected to your Spencare account. Revoke it in Settings if this wasn't you.`,
      };
    }
    case "MCP_REVOKED": {
      const { clientName } = c as { clientName: string };
      return {
        title: `MCP session revoked`,
        body: `${clientName} has been disconnected from your Spencare account.`,
      };
    }

    // ---- Summary reports ----
    case "WEEKLY_SUMMARY": {
      const { spentMinor, incomeMinor, topCategoryName } = c as {
        spentMinor: number; incomeMinor: number; topCategoryName: string | null;
      };
      const topCat = topCategoryName ? ` Most spending went to ${topCategoryName}.` : "";
      return {
        title: "Your weekly summary",
        body: `This week: ${fmt(spentMinor, currency)} spent, ${fmt(incomeMinor, currency)} received.${topCat}`,
      };
    }
    case "MONTHLY_SUMMARY": {
      const { monthName, spentMinor, incomeMinor, savingsRatePct } = c as {
        monthName: string; spentMinor: number; incomeMinor: number; savingsRatePct: number | null;
      };
      const savingsPart = savingsRatePct !== null ? ` Savings rate: ${savingsRatePct}%.` : "";
      return {
        title: `${monthName} summary`,
        body: `${monthName}: ${fmt(spentMinor, currency)} spent, ${fmt(incomeMinor, currency)} received.${savingsPart}`,
      };
    }

    case "DAILY_SUMMARY": {
      const {
        spentMinor, incomeMinor, netMinor, transactionCount,
        topCategoryName, insight, hasActivity,
      } = c as {
        spentMinor: number;
        incomeMinor: number;
        netMinor: number;
        transactionCount: number;
        topCategoryName: string | null;
        insight: string | null;
        hasActivity: boolean;
      };

      if (!hasActivity) {
        const quietBody = "No spending or income was recorded today. Your financial picture is steady.";
        return {
          title: "Your daily summary",
          body: quietBody,
          telegramBody: `No spending or income recorded today.\n\nYour financial picture is steady.\n\n<a href="https://spencare.vercel.app">Open Spencare</a>`,
        };
      }

      const netSign = netMinor >= 0 ? "+" : "";
      const inAppBody = [
        `Spending: ${fmt(spentMinor, currency)}`,
        incomeMinor > 0 ? `Income: ${fmt(incomeMinor, currency)}` : null,
        `Net: ${netSign}${fmt(netMinor, currency)}`,
        transactionCount > 0 ? `${transactionCount} transaction${transactionCount === 1 ? "" : "s"}` : null,
      ].filter(Boolean).join(" · ");

      const lines: string[] = [
        "<b>Today</b>",
        `• Spending: ${fmt(spentMinor, currency)}`,
        incomeMinor > 0 ? `• Income: ${fmt(incomeMinor, currency)}` : null,
        `• Net cash flow: ${netSign}${fmt(netMinor, currency)}`,
        `• Transactions: ${transactionCount}`,
      ].filter((l): l is string => l !== null);

      if (topCategoryName) {
        lines.push("", "<b>Worth knowing</b>", `• ${topCategoryName} was your largest spending category today.`);
      }
      if (insight) {
        lines.push("", `<i>${insight}</i>`);
      }
      lines.push("", `<a href="https://spencare.vercel.app">Open Spencare</a>`);

      return {
        title: "Your daily summary",
        body: inAppBody,
        telegramBody: lines.join("\n"),
      };
    }

    default: {
      return {
        title: "Spencare update",
        body: "Something worth knowing happened in your account.",
      };
    }
  }
}
