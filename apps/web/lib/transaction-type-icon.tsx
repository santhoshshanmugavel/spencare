import type { TransactionRow } from "@spencare/domain-application";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from "lucide-react";

/**
 * The colored type icon (income/expense/transfer) shown on every
 * transaction row across the app. Lives in its own `.tsx` file (rather
 * than inside `transaction-presentation.ts`, which is plain `.ts` and
 * shared by non-JSX callers too) so `/cash-flow/transactions` and the
 * Plans "Attach a transaction" picker render the exact same icon, not a
 * visually similar reimplementation.
 */
export function transactionTypeIcon(type: TransactionRow["type"]) {
  if (type === "income")
    return (
      <div className="flex size-9 items-center justify-center rounded-xl bg-income-subtle" aria-hidden="true">
        <ArrowDownLeft className="size-4 text-income" />
      </div>
    );
  if (type === "expense")
    return (
      <div className="flex size-9 items-center justify-center rounded-xl bg-expense-subtle" aria-hidden="true">
        <ArrowUpRight className="size-4 text-expense" />
      </div>
    );
  return (
    <div className="flex size-9 items-center justify-center rounded-xl bg-transfer-subtle" aria-hidden="true">
      <ArrowLeftRight className="size-4 text-transfer" />
    </div>
  );
}
