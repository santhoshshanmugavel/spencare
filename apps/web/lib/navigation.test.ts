import { describe, expect, it } from "vitest";
import { isNavItemActive } from "./navigation";

describe("isNavItemActive", () => {
  it("matches an exact route", () => {
    expect(isNavItemActive("/goals", "/goals")).toBe(true);
    expect(isNavItemActive("/home", "/home")).toBe(true);
  });

  it("matches a nested route under the section root (Cash Flow's sub-pages)", () => {
    expect(isNavItemActive("/cash-flow/transactions", "/cash-flow")).toBe(true);
    expect(isNavItemActive("/cash-flow/budgets", "/cash-flow")).toBe(true);
    expect(isNavItemActive("/cash-flow/bills", "/cash-flow")).toBe(true);
    expect(isNavItemActive("/cash-flow/import", "/cash-flow")).toBe(true);
  });

  it("matches every Settings sub-page even though the rail item's own href is the specific /settings/profile landing page", () => {
    expect(isNavItemActive("/settings/accounts", "/settings/profile")).toBe(true);
    expect(isNavItemActive("/settings/security", "/settings/profile")).toBe(true);
    expect(isNavItemActive("/settings/mcp", "/settings/profile")).toBe(true);
    expect(isNavItemActive("/settings/profile", "/settings/profile")).toBe(true);
  });

  it("does not match a different section, even one sharing a text prefix", () => {
    expect(isNavItemActive("/goals-archive", "/goals")).toBe(false);
    expect(isNavItemActive("/cash-flow-old", "/cash-flow")).toBe(false);
  });

  it("ignores a trailing slash on either side", () => {
    expect(isNavItemActive("/goals/", "/goals")).toBe(true);
    expect(isNavItemActive("/cash-flow/", "/cash-flow")).toBe(true);
  });

  it("ignores query params and hash fragments", () => {
    expect(isNavItemActive("/cash-flow?month=2026-08-01", "/cash-flow")).toBe(true);
    expect(isNavItemActive("/goals#top", "/goals")).toBe(true);
  });

  it("handles a dynamic segment in the current pathname (e.g. a goal detail route)", () => {
    expect(isNavItemActive("/goals/abc-123", "/goals")).toBe(true);
  });

  it("Spensa's chat route matches none of Home/Cash Flow/Goals/Settings -- there is no fifth rail icon for it", () => {
    for (const href of ["/home", "/cash-flow", "/goals", "/settings/profile"]) {
      expect(isNavItemActive("/spensa/conv-123", href)).toBe(false);
    }
  });

  it("root path never falsely matches a real section", () => {
    expect(isNavItemActive("/", "/home")).toBe(false);
    expect(isNavItemActive("/", "/")).toBe(true);
  });
});
