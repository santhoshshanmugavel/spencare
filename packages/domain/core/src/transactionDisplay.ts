type TransactionLike = {
  item_name: string | null;
  merchant: string | null;
  description: string | null;
  type: string;
};

export interface TransactionDisplayFields {
  effectiveItemName: string | null;
  displayTitle: string;
  displayMerchant: string | null;
}

const TRANSFER_LABELS: Record<string, string> = {
  transfer: "Transfer",
  goal_contribution: "Goal contribution",
  goal_withdrawal: "Goal withdrawal",
};

/**
 * Canonical transaction display mapper.
 *
 * Legacy rows have item_name=NULL and carry the item description in the
 * `description` column. This normalises both shapes into one DTO so every
 * view (list row, detail panel, edit form, MCP) uses the same rule:
 *
 *   effectiveItemName = item_name ?? description   (WHAT was bought/paid)
 *   displayMerchant  = merchant                    (WHERE / WHO)
 *   displayTitle     = effectiveItemName ?? merchant ?? type-based fallback
 */
export function getTransactionDisplay(t: TransactionLike): TransactionDisplayFields {
  const effectiveItemName = t.item_name ?? t.description ?? null;
  const displayTitle =
    effectiveItemName ??
    t.merchant ??
    TRANSFER_LABELS[t.type] ??
    (t.type === "income" ? "Income" : "Transaction");
  return {
    effectiveItemName,
    displayTitle,
    displayMerchant: t.merchant,
  };
}
