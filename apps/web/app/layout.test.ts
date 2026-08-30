import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 23 (Google Sans Flex migration) regression guard.
 *
 * `next/font/google`'s real export is a build-time-only construct
 * (Next.js's Turbopack/webpack plugin rewrites the import at compile
 * time based on font-data.json) -- it cannot be meaningfully imported or
 * executed inside plain Vitest the way a normal module can, and asserting
 * on an actual computed `font-family` would mean asserting on real
 * browser font rendering, which the migration's own acceptance criteria
 * explicitly warn against as a brittle test shape. This test instead
 * pins the architectural invariants at the source level -- the things a
 * future edit could silently break without any type error or runtime
 * failure surfacing it:
 *
 * 1. The root layout loads Google Sans Flex (not a reverted/different
 *    family) as the application's default typeface.
 * 2. It names that loader's CSS variable `--font-sans` -- the exact
 *    variable globals.css's `@theme inline` block reads
 *    (`--font-sans: var(--font-sans)`). This pairing is exactly what
 *    silently broke before this phase (the previous Geist setup named
 *    its variable `--font-geist-sans`, which `--font-sans: var(--font-
 *    sans)` could never see -- confirmed live: the whole app was
 *    rendering in the browser's default serif fallback, not the
 *    intended font, with zero build or type error to catch it).
 * 3. The resolved variable is actually applied to `<html>`'s className,
 *    not merely instantiated and left unused.
 * 4. Geist Mono is still loaded for the legitimate monospace exceptions
 *    (masked API keys, MCP tokens, TOTP secrets/backup codes) --
 *    Google Sans Flex becoming the default application font must never
 *    silently remove those.
 */
const layoutSource = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf-8");
const globalsCssSource = readFileSync(join(process.cwd(), "app/globals.css"), "utf-8");

describe("root layout typography (Phase 23 -- Google Sans Flex)", () => {
  it("loads Google Sans Flex from next/font/google as the application default", () => {
    expect(layoutSource).toMatch(/import\s*\{[^}]*Google_Sans_Flex[^}]*\}\s*from\s*"next\/font\/google"/);
  });

  it("names the Google Sans Flex loader's variable exactly --font-sans, matching what globals.css's @theme block reads", () => {
    const googleSansFlexCall = layoutSource.match(/Google_Sans_Flex\(\{([\s\S]*?)\}\)/)?.[1] ?? "";
    expect(googleSansFlexCall).toMatch(/variable:\s*"--font-sans"/);

    expect(globalsCssSource).toMatch(/--font-sans:\s*var\(--font-sans\)/);
  });

  it("applies the resolved font's className to <html>, not just declares it unused", () => {
    expect(layoutSource).toMatch(/googleSansFlex\.variable/);
  });

  it("still loads Geist Mono for legitimate monospace/technical use (masked keys, tokens, TOTP secrets) -- never silently removed", () => {
    expect(layoutSource).toMatch(/import\s*\{[^}]*Geist_Mono[^}]*\}\s*from\s*"next\/font\/google"/);
    expect(layoutSource).toMatch(/variable:\s*"--font-geist-mono"/);
    expect(globalsCssSource).toMatch(/--font-mono:\s*var\(--font-geist-mono\)/);
  });

  it("never reintroduces a Geist Sans (non-mono) import -- the whole point of this migration", () => {
    // Deliberately checks only the import statements, not the whole file
    // text -- this file's own comments reference "Geist" by name while
    // explaining the migration/bug history, which must not itself trip
    // this guard.
    const importLines = layoutSource.split("\n").filter((line) => line.trim().startsWith("import"));
    for (const line of importLines) {
      expect(line).not.toMatch(/\bGeist\b(?!_Mono)/);
    }
  });
});
