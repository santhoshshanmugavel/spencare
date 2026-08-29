import { describe, expect, it } from "vitest";
import * as domainApplicationConfirmation from "@spencare/domain-application";
import * as reExported from "./confirmation.js";

/**
 * The real confirmation-cascade tests now live at
 * `packages/domain/application/src/commands/confirmation.test.ts` (Phase
 * 18 relocation, locked decision #2) -- this file only proves the
 * re-export is real and identity-preserving (the literal same function
 * references, not a re-implementation), so the two modules can never
 * silently drift into two different confirmation mechanisms.
 */
describe("packages/ai's confirmation.js — thin re-export, not a second implementation", () => {
  it("proposeCommand/confirmCommand/cancelPendingCommand/getProposal/describeAmountForProvider are the exact same function references as domain-application's", () => {
    expect(reExported.proposeCommand).toBe(domainApplicationConfirmation.proposeCommand);
    expect(reExported.confirmCommand).toBe(domainApplicationConfirmation.confirmCommand);
    expect(reExported.cancelPendingCommand).toBe(domainApplicationConfirmation.cancelPendingCommand);
    expect(reExported.getProposal).toBe(domainApplicationConfirmation.getProposal);
    expect(reExported.describeAmountForProvider).toBe(domainApplicationConfirmation.describeAmountForProvider);
  });
});
