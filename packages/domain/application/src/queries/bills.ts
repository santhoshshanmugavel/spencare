import {
  getBill as getBillRow,
  listBillPredictions as listBillPredictionsRow,
  type BillDefinitionRow,
  type BillPredictionWithDefinition,
  type ListBillPredictionsOptions,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

/** api-architecture.md §13's exact query name -- fetches one bill definition (for the edit form / detail view). */
export async function getBill(ctx: AuthContext, billId: string): Promise<BillDefinitionRow | null> {
  return getBillRow(ctx.supabase, ctx.userId, billId);
}

/** api-architecture.md §13's exact query name -- the Bills list feed, each prediction joined with its owning bill's identity (merchant/category/cadence) for a single round trip, no N+1. */
export async function listBillPredictions(
  ctx: AuthContext,
  options: ListBillPredictionsOptions = {},
): Promise<BillPredictionWithDefinition[]> {
  return listBillPredictionsRow(ctx.supabase, ctx.userId, options);
}
