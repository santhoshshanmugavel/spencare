import { describe, expect, it } from "vitest";
import { safeRedirectTarget } from "./middleware";

/**
 * Open-redirect prevention (Phase 5 §6/§12) -- the `redirect` query param is
 * untrusted input from the URL, consumed after successful auth to decide
 * where the user lands. Every value that could send the browser off-origin
 * must be rejected.
 */
describe("safeRedirectTarget", () => {
  it("accepts a plain internal path", () => {
    expect(safeRedirectTarget("/settings/profile")).toBe("/settings/profile");
  });

  it("accepts an internal path with a query string", () => {
    expect(safeRedirectTarget("/settings/security?tab=2fa")).toBe("/settings/security?tab=2fa");
  });

  it("accepts the root path", () => {
    expect(safeRedirectTarget("/")).toBe("/");
  });

  it("returns null for a missing param", () => {
    expect(safeRedirectTarget(null)).toBeNull();
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeRedirectTarget("https://evil.example")).toBeNull();
    expect(safeRedirectTarget("http://evil.example/phish")).toBeNull();
  });

  it("rejects a protocol-relative URL (browsers treat // as off-origin)", () => {
    expect(safeRedirectTarget("//evil.example")).toBeNull();
    expect(safeRedirectTarget("//evil.example/path")).toBeNull();
  });

  it("rejects a javascript: URL", () => {
    expect(safeRedirectTarget("javascript:alert(1)")).toBeNull();
  });

  it("rejects a data: URL", () => {
    expect(safeRedirectTarget("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects a value with no leading slash at all", () => {
    expect(safeRedirectTarget("evil.example")).toBeNull();
    expect(safeRedirectTarget("settings/profile")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(safeRedirectTarget("")).toBeNull();
  });

  it("rejects backslash tricks some parsers normalize to //", () => {
    // Not literally "//", but included because some URL parsers treat
    // leading backslashes as equivalent to forward slashes -- this
    // function's own check is a strict startsWith("/") that does NOT
    // special-case backslashes, so this should still be REJECTED as
    // off-shape input rather than silently normalized and accepted.
    expect(safeRedirectTarget("\\\\evil.example")).toBeNull();
  });
});
