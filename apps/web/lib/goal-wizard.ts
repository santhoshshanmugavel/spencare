/**
 * Pure, deterministic content/logic for `<GoalWizardSheet>` (Phase 33
 * §10/§21 -- the conversational Spensa goal-creation flow, reproducing
 * `Goal Creation.pdf`/`Goal Creation-1.pdf`'s real Q&A sequence: category
 * -> trip-band -> tiered cost estimate -> existing savings -> target date
 * -> funding account -> summary).
 *
 * Deliberately NOT a call to the real Spensa AI provider: the reference
 * screens show a SCRIPTED decision tree (fixed categories, fixed cost
 * bands, fixed date/amount chips), not free-form generative text -- the
 * only "intelligence" reproduced here is the branching itself, kept as
 * plain, auditable, testable functions. Building a live LLM call for a
 * core creation flow would (a) require a configured AI provider this
 * session cannot fabricate (engagement-wide rule), and (b) reproduce the
 * exact "fake AI" pattern Phase 33 §33 forbids if the branching were
 * instead faked with regex/keyword text-parsing dressed up as
 * understanding. A deterministic, clearly-scoped decision tree is the
 * honest version of "the smallest architecture that genuinely reproduces
 * the intended interaction" (§10).
 *
 * The cost bands below are ILLUSTRATIVE PLANNING ANCHORS, not sourced
 * benchmarks -- worded with the same hedged "usually costs around"
 * language the reference itself uses, never presented as a personalized
 * or authoritative figure (§11: "never manufacture benchmarks" presented
 * as fact). "Enter my own" is always offered alongside every tier and is
 * visually no less prominent than the suggested chips.
 */

export type GoalCategory = "emergency" | "trip" | "vehicle" | "other";
export type TripBand = "international" | "domestic";

export const GOAL_CATEGORY_LABELS: Record<GoalCategory, string> = {
  emergency: "Emergency Fund",
  trip: "Trip",
  vehicle: "Vehicle",
  other: "Something else",
};

export interface CostEstimate {
  /** Three tiers, ascending, in minor currency units. */
  tiersMinor: [number, number, number];
  tierLabels: [string, string, string];
  /** Spensa's hedged planning sentence shown above the tier chips. */
  hint: string;
}

/**
 * `category`/`tripBand` never reach the funding-account capability check
 * or any Money arithmetic beyond simple chip values -- this is copy +
 * suggested numbers only, not a financial calculation.
 */
export function estimateGoalCost(category: GoalCategory, tripBand?: TripBand): CostEstimate {
  if (category === "trip") {
    if (tripBand === "international") {
      return {
        tiersMinor: [4_000_000, 6_000_000, 8_000_000],
        tierLabels: ["₹40,000", "₹60,000", "₹80,000"],
        hint: "Trips abroad usually cost around ₹40,000–₹80,000 depending on flights and stay.",
      };
    }
    return {
      tiersMinor: [1_500_000, 2_500_000, 4_000_000],
      tierLabels: ["₹15,000", "₹25,000", "₹40,000"],
      hint: "Domestic trips usually cost around ₹15,000–₹40,000 depending on distance and stay.",
    };
  }
  if (category === "vehicle") {
    return {
      tiersMinor: [5_000_000, 15_000_000, 30_000_000],
      tierLabels: ["₹50,000", "₹1,50,000", "₹3,00,000"],
      hint: "Vehicle costs vary a lot — here are some common starting points.",
    };
  }
  if (category === "emergency") {
    return {
      tiersMinor: [2_500_000, 7_500_000, 15_000_000],
      tierLabels: ["₹25,000", "₹75,000", "₹1,50,000"],
      hint: "A common starting point is 3–6 months of essential expenses.",
    };
  }
  return {
    tiersMinor: [1_000_000, 2_500_000, 5_000_000],
    tierLabels: ["₹10,000", "₹25,000", "₹50,000"],
    hint: "Here are some common starting points — adjust to fit your goal.",
  };
}

/** Fixed "have you already saved something" chips -- category-agnostic (matches Goal Creation.pdf exactly: ₹0 / ₹5,000 / ₹10,000). */
export const EXISTING_SAVINGS_CHIPS_MINOR: [number, number, number] = [0, 500_000, 1_000_000];

export interface DateSuggestion {
  label: string;
  iso: string;
}

/**
 * Three upcoming target-date suggestions, +6/+12/+18 months from `today`,
 * on the 1st of that month (the exact day doesn't matter to
 * `calculateGoalProgress`'s whole-month counting -- picking the 1st keeps
 * the ISO value deterministic and easy to test).
 */
export function suggestTargetDates(today: Date): [DateSuggestion, DateSuggestion, DateSuggestion] {
  const offsets: [number, number, number] = [6, 12, 18];
  const [a, b, c] = offsets.map((months) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months, 1));
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    return { label, iso };
  });
  return [a, b, c];
}

/** Suggested goal name for categories that don't ask a free-text name (Emergency Fund only -- Trip/Vehicle/Something else always ask). */
export const DEFAULT_GOAL_NAME: Partial<Record<GoalCategory, string>> = {
  emergency: "Emergency Fund",
};
