/**
 * PersonalizedQuickReplyEngine — "What next?" suggestions.
 *
 * SYSTEM RULES (from master spec, locked):
 * 1. Returns 0–3 suggestions. Never more than 3.
 * 2. Returns 0 when Spensa is waiting for required user input
 *    (e.g. "How much did you spend?"). Do NOT show unrelated suggestions.
 * 3. These are "What next?" chips near the input — NOT "Finish this step"
 *    action buttons (those are AI Response Buttons = proposals, rendered
 *    separately via ConsequentialActionPreview).
 * 4. Every chip goes through the same Spensa send path as typed text.
 * 5. Purely client-side — no extra API call.
 */

export type QuickReply = { id: string; label: string };

/**
 * Patterns that indicate Spensa is waiting for required input.
 * When any matches, return 0 quick replies.
 */
const WAITING_PATTERNS = [
  /how much did you spend\??/i,
  /how much was (it|that|the)\??/i,
  /what (amount|was the amount)\??/i,
  /which account did you use\??/i,
  /what category (should i|do you want)\??/i,
  /can you tell me (more|which)\??/i,
  /could you (clarify|specify|confirm)\??/i,
  /what (is|was) (it|that) for\??/i,
];

type Rule = {
  /** Pattern matched against the last assistant message */
  pattern: RegExp;
  /** Up to 3 suggestions */
  replies: QuickReply[];
};

const RULES: Rule[] = [
  // Expense completed
  {
    pattern: /\b(added|recorded|logged).{0,30}(expense|spent|₹|dinner|food|travel|shopping|snack|lunch|coffee)\b/i,
    replies: [
      { id: "exp-today", label: "Show today's spending" },
      { id: "exp-safe", label: "What's safe to spend?" },
      { id: "exp-another", label: "Add another expense" },
    ],
  },
  // Income completed
  {
    pattern: /\b(added|recorded|logged).{0,30}(income|salary|credited|earned|freelance|refund|cashback)\b/i,
    replies: [
      { id: "inc-month", label: "How much can I spend this month?" },
      { id: "inc-goals", label: "Review my goals" },
      { id: "inc-summary", label: "Show this month's summary" },
    ],
  },
  // Goal created
  {
    pattern: /\b(goal|fund|target).{0,30}(created|ready|set up|done)\b/i,
    replies: [
      { id: "goal-doing", label: "How am I doing?" },
      { id: "goal-plan", label: "Change my plan" },
      { id: "goal-contribute", label: "Add money now" },
    ],
  },
  // Goal status / progress query
  {
    pattern: /\b(saved|on track|behind|progress|you(\'?ve|ve) saved|₹.{0,10}saved)\b/i,
    replies: [
      { id: "goal-monthly", label: "How much should I save monthly?" },
      { id: "goal-adjust", label: "Adjust this goal" },
    ],
  },
  // Budget
  {
    pattern: /\b(budget|category|overspending|spending limit|used \d+%)\b/i,
    replies: [
      { id: "bud-left", label: "How much is left?" },
      { id: "bud-attention", label: "Which category needs attention?" },
    ],
  },
  // Account balance
  {
    pattern: /\b(balance|₹.{0,10}(in|available)|account|IDFC|HDFC|savings|bank)\b/i,
    replies: [
      { id: "bal-safe", label: "What's safe to spend?" },
      { id: "bal-recent", label: "Show recent transactions" },
      { id: "bal-goals", label: "Review my goals" },
    ],
  },
  // Credit card
  {
    pattern: /\b(credit card|card balance|outstanding|repay|payment due|utilization)\b/i,
    replies: [
      { id: "cc-txns", label: "Show card transactions" },
      { id: "cc-when", label: "When should I repay?" },
    ],
  },
  // Report / monthly summary
  {
    pattern: /\b(spent|report|summary|month.{0,15}(spent|income|net)|cash flow)\b/i,
    replies: [
      { id: "rep-why", label: "Why did spending increase?" },
      { id: "rep-improve", label: "What should I improve?" },
      { id: "rep-compare", label: "Compare with last month" },
    ],
  },
  // Receipt / bank statement upload
  {
    pattern: /\b(import(ed)?|found \d+|transactions? (added|imported)|statement upload)\b/i,
    replies: [
      { id: "upl-summary", label: "Give me a summary" },
      { id: "upl-unusual", label: "Show unusual expenses" },
    ],
  },
  // Emotional / supportive
  {
    pattern: /\b(anxious|stressed|worried|overwhelmed|you('?re| are) doing (well|better|okay))\b/i,
    replies: [
      { id: "emo-facts", label: "Show me the facts" },
      { id: "emo-focus", label: "What should I focus on?" },
    ],
  },
];

const UNIVERSAL_POOL: QuickReply[] = [
  { id: "ur-expense", label: "Add an expense" },
  { id: "ur-safe", label: "What's safe to spend?" },
  { id: "ur-month", label: "How am I doing this month?" },
  { id: "ur-goals", label: "Review my goals" },
];

/**
 * Generate 0–3 contextual "What next?" quick reply chips.
 *
 * Returns 0 when Spensa is waiting for required user input.
 * Otherwise returns up to 3 contextually relevant suggestions.
 * Falls back to rotating universal suggestions when no rule matches.
 */
export function generateQuickReplies(lastAssistantMessage: string, rotationSeed?: number): QuickReply[] {
  const text = lastAssistantMessage.trim();
  if (!text) return [];

  // If Spensa is waiting for required input → no quick replies
  for (const pattern of WAITING_PATTERNS) {
    if (pattern.test(text)) return [];
  }

  // Try each rule in order — first match wins
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return rule.replies.slice(0, 3);
    }
  }

  // Universal fallback (rotate)
  return pickUniversal(rotationSeed);
}

function pickUniversal(seed?: number): QuickReply[] {
  const offset = (seed ?? Date.now()) % UNIVERSAL_POOL.length;
  const rotated = [...UNIVERSAL_POOL.slice(offset), ...UNIVERSAL_POOL.slice(0, offset)];
  return rotated.slice(0, 3);
}
