import {
  createLoan,
  updateLoan,
  deleteLoan,
  getLoan,
  listLoans,
  type LoanRow,
  type CreateLoanPatch,
  type UpdateLoanPatch,
} from "@spencare/domain-infra";
import type { AuthContext } from "../types.js";

export type { LoanRow };

export async function getLoanById(ctx: AuthContext, loanId: string): Promise<LoanRow | null> {
  return getLoan(ctx.supabase, ctx.userId, loanId);
}

export async function listAllLoans(ctx: AuthContext): Promise<LoanRow[]> {
  return listLoans(ctx.supabase, ctx.userId);
}

export async function addLoan(ctx: AuthContext, patch: CreateLoanPatch): Promise<LoanRow> {
  return createLoan(ctx.supabase, ctx.userId, patch);
}

export async function editLoan(ctx: AuthContext, loanId: string, patch: UpdateLoanPatch): Promise<LoanRow> {
  return updateLoan(ctx.supabase, ctx.userId, loanId, patch);
}

export async function removeLoan(ctx: AuthContext, loanId: string): Promise<void> {
  return deleteLoan(ctx.supabase, ctx.userId, loanId);
}
