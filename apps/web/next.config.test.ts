import { describe, expect, it } from "vitest";
import nextConfig from "./next.config.js";

/**
 * Regression coverage for the Phase 26 fix: Next.js Server Actions default
 * to a 1MB body limit, which silently blocks any real avatar or goal-image
 * upload between 1MB-5MB (both features validate up to 5MB) with a
 * generic 500, never reaching the friendly application-level error
 * message. This guards against that override being accidentally removed
 * or shrunk back below the 5MB validation ceiling.
 */
describe("next.config.ts — Server Actions body size limit", () => {
  it("overrides the default 1MB limit to something above the 5MB upload validation ceiling", () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(limit).toBeDefined();
    // Accept either a numeric byte count or a "Nmb"/"Nkb" string, per
    // Next.js's own `bytes`-library-backed config format.
    const bytes =
      typeof limit === "number"
        ? limit
        : Number(String(limit).toLowerCase().replace("mb", "")) * 1024 * 1024;
    expect(bytes).toBeGreaterThan(5 * 1024 * 1024);
  });
});
