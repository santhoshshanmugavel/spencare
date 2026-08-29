import { describe, expect, it } from "vitest";
import { SPENSA_SYSTEM_PROMPT } from "./systemPrompt.js";

/**
 * These tests assert on CONTENT, not on model behavior -- a system prompt
 * cannot itself be "proven correct" by a unit test the way structural code
 * can. What this DOES prove: every required behavioral instruction from
 * the Spensa Spec v1.0 Correction Pass is actually present in the string
 * that gets sent to the provider, so a future edit that accidentally drops
 * one (e.g. during a refactor) fails loudly here rather than silently
 * shipping a degraded prompt.
 */
describe("SPENSA_SYSTEM_PROMPT — required content", () => {
  it("establishes Spensa's identity as a financial context engine, not a generic chatbot", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/Spensa/);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/not a generic chatbot/i);
  });

  it("states the core principle: grounded in data, never the authoritative calculator, never fabricated", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never.{0,20}the authoritative calculator/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never fabricate/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never guess/i);
  });

  it("describes the Answer/Reason/Suggestion response structure", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/Answer/);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/Reason/);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/Suggestion/);
  });

  it("establishes personality: friendly partner, smart advisor, calm/non-judgmental tone", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/friendly partner/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/smart advisor/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/calm/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/non-judgmental/i);
  });

  it("lists the financial-safety restrictions: no investment advice, no market predictions", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/investment advice/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/predict markets/i);
  });

  it("states the credit rule: credit is borrowed, never spendable cash", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/credit is borrowed money/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never.{0,80}spendable cash/i);
  });

  it("states the document/import-as-data rule", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/DATA/);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never an instruction/i);
  });

  it("states the confirmation rule: natural language never confirms a pending action", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never.{0,20}confirm.{0,40}pending/i);
    expect(SPENSA_SYSTEM_PROMPT.toLowerCase()).toContain('"yes,"');
    expect(SPENSA_SYSTEM_PROMPT.toLowerCase()).toContain('"confirmed,"');
  });

  it("states the tools rule: use tools for facts, never recompute a financial value independently", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never independently recompute/i);
  });

  it("states the missing/outdated data honesty rule", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/say so honestly/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never claim data is more current/i);
  });

  it("states the data-confidence rule: manual/imported only, never claim synced/live data", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/manually recorded or imported/i);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never claim data is .synced./i);
  });

  it("states the Privacy Mode rule: never reconstruct a masked figure", () => {
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/Privacy Mode/);
    expect(SPENSA_SYSTEM_PROMPT).toMatch(/never attempt to guess, reconstruct/i);
  });
});
