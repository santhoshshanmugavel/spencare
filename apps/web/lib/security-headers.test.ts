import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./security-headers";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Default to production for every test except the dedicated dev/prod
  // one below -- production is the security-critical case to get right.
  process.env = { ...ORIGINAL_ENV, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NODE_ENV: "production" };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("applySecurityHeaders", () => {
  it("sets every expected header", () => {
    const response = applySecurityHeaders(NextResponse.next());
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
  });

  it("scopes connect-src/img-src to the configured Supabase origin, never a wildcard", () => {
    const response = applySecurityHeaders(NextResponse.next());
    const csp = response.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:54321");
    expect(csp).toContain("img-src 'self' data: blob: http://127.0.0.1:54321");
    expect(csp).not.toContain("connect-src *");
  });

  it("never allows the HMR websocket scheme in production -- there is no HMR socket in a production build", () => {
    const csp = applySecurityHeaders(NextResponse.next()).headers.get("Content-Security-Policy")!;
    expect(csp).not.toContain("connect-src 'self' ws:");
  });

  it("denies framing entirely -- Spencare is never embedded", () => {
    const response = applySecurityHeaders(NextResponse.next());
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("never throws when NEXT_PUBLIC_SUPABASE_URL is missing or malformed -- degrades to a same-origin-only policy", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    expect(() => applySecurityHeaders(NextResponse.next())).not.toThrow();
    const response = applySecurityHeaders(NextResponse.next());
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
  });

  it("applies headers to a redirect response too, not only a pass-through", () => {
    const response = applySecurityHeaders(NextResponse.redirect("http://localhost:3000/login"));
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("allows 'unsafe-eval' and the ws: HMR scheme outside production, but neither in production", () => {
    process.env = { ...process.env, NODE_ENV: "development" };
    const devCsp = applySecurityHeaders(NextResponse.next()).headers.get("Content-Security-Policy")!;
    expect(devCsp).toContain("'unsafe-eval'");
    expect(devCsp).toContain("connect-src 'self' ws:");

    process.env = { ...process.env, NODE_ENV: "production" };
    const prodCsp = applySecurityHeaders(NextResponse.next()).headers.get("Content-Security-Policy")!;
    expect(prodCsp).not.toContain("'unsafe-eval'");
    expect(prodCsp).not.toContain(" ws:");
  });
});
