/**
 * The confirmation cascade (propose/confirm) was relocated to
 * `packages/domain/application/src/commands/confirmation.ts` during Phase
 * 18 (MCP Integration), locked decision #2 -- `apps/mcp-server` cannot
 * depend on `packages/ai`, so the one mechanism both Spensa and MCP must
 * share can only live at the domain-application layer. This file is a
 * thin re-export, kept so every existing `packages/ai` import path
 * (`from "./confirmation.js"`) keeps working without a churn-only edit
 * across every call site -- there is exactly ONE real implementation, not
 * two.
 */
export {
  proposeCommand,
  confirmCommand,
  cancelPendingCommand,
  getProposal,
  describeAmountForProvider,
  type ProposalResult,
  type ProposalPreviewField,
  type ConfirmResult,
  type ConfirmError,
} from "@spencare/domain-application";
