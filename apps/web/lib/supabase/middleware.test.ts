import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { safeRedirectTarget } from "./middleware";

/**
 * `updateSession`'s self-authenticating-API-path bypass (Phase 22
 * forensic finding): a fake `createServerClient` whose `getUser()` always
 * resolves to "no session" -- exactly what a real Vercel Cron invocation
 * or remote MCP client request looks like (neither ever carries a
 * Spencare browser session cookie). Never resolved/imported for real in
 * this test file -- these routes must never even construct a Supabase
 * session client, so this mock is a canary too: if `updateSession`
 * regresses back to reaching this call for `/api/mcp`/`/api/cron/*`,
 * this mock's `getUser` would be the thing an accidental "unauthenticated
 * -> redirect to /login" branch depends on, which the tests below prove
 * does NOT happen for those paths.
 */
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) })),
  })),
}));

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

describe("updateSession — self-authenticating API paths bypass the session/redirect gate (Phase 22 fix)", () => {
  it("passes an unauthenticated /api/mcp request through instead of redirecting to /login", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/api/mcp", { headers: { authorization: "Bearer some-mcp-token" } });
    const response = await updateSession(request);
    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes an unauthenticated /api/mcp/anything-nested request through too", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/api/mcp/some-sub-path");
    const response = await updateSession(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes an unauthenticated /api/cron/gmail-sync request through instead of redirecting to /login", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/api/cron/gmail-sync", { headers: { authorization: "Bearer some-cron-secret" } });
    const response = await updateSession(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects an unauthenticated request to a normal protected page (regression guard)", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/home");
    const response = await updateSession(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("still redirects an unauthenticated request to another api route that is NOT self-authenticating (e.g. /api/spensa/chat, which needs a real browser session)", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/api/spensa/chat");
    const response = await updateSession(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("passes an unauthenticated /oauth/token request through -- a machine-to-machine grant exchange, never cookie-based (Phase 27)", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/oauth/token", { method: "POST" });
    const response = await updateSession(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes an unauthenticated /oauth/register request through -- dynamic client registration has no user session at all (Phase 27)", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/oauth/register", { method: "POST" });
    const response = await updateSession(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes an unauthenticated /.well-known/oauth-authorization-server request through -- public discovery metadata (Phase 27)", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/.well-known/oauth-authorization-server");
    const response = await updateSession(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("still redirects an unauthenticated /oauth/authorize request to /login -- the human consent screen goes through the normal session gate, deliberately NOT self-authenticating (Phase 27)", async () => {
    const { updateSession } = await import("./middleware.js");
    const request = new NextRequest("http://localhost:3000/oauth/authorize?client_id=abc");
    const response = await updateSession(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    // The original destination (including its query string) must survive
    // the round trip through login, or the OAuth request context is lost.
    expect(response.headers.get("location")).toContain(encodeURIComponent("/oauth/authorize"));
  });
});
