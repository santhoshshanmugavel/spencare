/**
 * PersonalizedQuickReplyEngine — "What next?" suggestions (NOT AI Response Buttons).
 *
 * Two separate systems, never mixed:
 * 1. AI Response Buttons  = "Finish this step" — attached to a proposal, disappear after action
 * 2. Personalized Quick Replies = "What next?" — contextual, rotating, shown near the input
 *
 * This file implements system #2. It is purely rule-based and runs client-side
 * from the last assistant message text — no extra API call, no financial calculations.
 */

export type QuickReply = { id: string; label: string };

const UNIVERSAL_FALLBACKS: QuickReply[] = [
  { id: "ur-add-expense", label: "Add an expense" },
  { id: "ur-safe-to-spend", label: "What's safe to spend?" },
  { id: "ur-this-month", label: "How am I doing this month?" },
  { id: "ur-goals", label: "Review my goals" },
  { id: "ur-insights", label: "Show insights" },
  { id: "ur-plan-ahead", label: "Plan ahead" },
];

type Rule = {
  keywords: RegExp;
  replies: QuickReply[];
};

const RULES: Rule[] = [
  {
    keywords: /\b(expense|spent|added.*food|added.*dining|recorded.*expense)\b/i,
    replies: [
      { id: "exp-today", label: "Show today's spending" },
      { id: "exp-safe", label: "What's safe to spend now?" },
      { id: "exp-another", label: "Add another expense" },
    ],
  },
  {
    keywords: /\b(income|salary|credited|earned|freelance|received)\b/i,
    replies: [
      { id: "inc-month", label: "How much did I earn this month?" },
      { id: "inc-safe", label: "What can I spend now?" },
      { id: "inc-goals", label: "Review my goals" },
      { id: "inc-summary", label: "Show this month's summary" },
    ],
  },
  {
    keywords: /\b(goal|saving|saved|emergency|vacation|target)\b/i,
    replies: [
      { id: "goal-track", label: "Am I on track?" },
      { id: "goal-monthly", label: "How much should I save monthly?" },
      { id: "goal-adjust", label: "Adjust this goal" },
      { id: "goal-all", label: "Review all goals" },
    ],
  },
  {
    keywords: /\b(budget|overspending|limit|exceeded|category)\b/i,
    replies: [
      { id: "bud-left", label: "How much is left?" },
      { id: "bud-attention", label: "Which category needs attention?" },
      { id: "bud-reduce", label: "How can I reduce it?" },
    ],
  },
  {
    keywords: /\b(balance|account|bank|IDFC|HDFC|card|cash)\b/i,
    replies: [
      { id: "bal-safe", label: "What's safe to spend?" },
      { id: "bal-breakdown", label: "Show account breakdown" },
      { id: "bal-recent", label: "Recent transactions" },
    ],
  },
  {
    keywords: /\b(bill|repay|payment|due|credit card)\b/i,
    replies: [
      { id: "bill-when", label: "When should I repay?" },
      { id: "bill-card", label: "Show card spending" },
      { id: "bill-summary", label: "Show card summary" },
    ],
  },
  {
    keywords: /\b(report|month|summary|comparison|spent more|less)\b/i,
    replies: [
      { id: "rep-why", label: "Why did spending increase?" },
      { id: "rep-improve", label: "What should I improve?" },
      { id: "rep-compare", label: "Compare with last month" },
    ],
  },
  {
    keywords: /\b(anxious|stressed|worried|losing control|overwhelmed|okay financially)\b/i,
    replies: [
      { id: "emo-facts", label: "Show me the facts" },
      { id: "emo-focus", label: "What should I focus on?" },
      { id: "emo-well", label: "What am I doing well?" },
    ],
  },
  {
    keywords: /\b(refund|cashback|gift|rebate)\b/i,
    replies: [
      { id: "ref-recent", label: "Show recent income" },
      { id: "ref-spent", label: "Where did I spend most?" },
    ],
  },
];

/**
 * Generate contextual quick reply suggestions from the last assistant message.
 * Returns 2-4 suggestions. Falls back to rotating universal suggestions when
 * no rule matches.
 */
export function generateQuickReplies(lastAssistantMessage: string, rotationSeed?: number): QuickReply[] {
  const text = lastAssistantMessage.trim();
  if (!text) return pickUniversal(rotationSeed);

  for (const rule of RULES) {
    if (rule.keywords.test(text)) {
      return rule.replies.slice(0, 4);
    }
  }

  return pickUniversal(rotationSeed);
}

function pickUniversal(seed?: number): QuickReply[] {
  const offset = (seed ?? Date.now()) % UNIVERSAL_FALLBACKS.length;
  const rotated = [...UNIVERSAL_FALLBACKS.slice(offset), ...UNIVERSAL_FALLBACKS.slice(0, offset)];
  return rotated.slice(0, 4);
}
