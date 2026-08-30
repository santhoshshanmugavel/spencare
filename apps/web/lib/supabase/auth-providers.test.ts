import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGoogleSignInEnabled } from "./auth-providers";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key" };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function mockSettingsResponse(body: unknown, ok = true) {
  global.fetch = vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe("isGoogleSignInEnabled (Phase 22 forensic fix)", () => {
  it("returns true when the live Auth settings endpoint reports google: true", async () => {
    mockSettingsResponse({ external: { google: true, email: true } });
    expect(await isGoogleSignInEnabled()).toBe(true);
  });

  it("returns false when the live Auth settings endpoint reports google: false", async () => {
    mockSettingsResponse({ external: { google: false, email: true } });
    expect(await isGoogleSignInEnabled()).toBe(false);
  });

  it("fails closed on a non-OK response", async () => {
    mockSettingsResponse({ external: { google: true } }, false);
    expect(await isGoogleSignInEnabled()).toBe(false);
  });

  it("fails closed on a network error/timeout, never throws", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    await expect(isGoogleSignInEnabled()).resolves.toBe(false);
  });

  it("fails closed on a malformed response shape", async () => {
    mockSettingsResponse({ unexpected: "shape" });
    expect(await isGoogleSignInEnabled()).toBe(false);
  });

  it("fails closed without ever calling fetch when Supabase env vars are missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    expect(await isGoogleSignInEnabled()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the anon key as the apikey header, never a service-role or other secret", async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ external: { google: true } }) }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    await isGoogleSignInEnabled();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:54321/auth/v1/settings");
    expect(init?.headers).toMatchObject({ apikey: "anon-key" });
  });
});
