# Phase 23 — Google Sans Flex Typography Migration Final Report

## 1. Baseline

`git status` clean except the two pre-disclosed untracked items (`.claude/`, `packages/domain/infra/src/generated/`). `git rev-parse HEAD` = `a566375...` (Phase 22 close). Full regression run before any change: 532 web tests / 59 files passing (standalone; one unrelated test flakes only under `turbo`'s parallel runner, a pre-documented artifact, not a real failure), build/typecheck/conformance all clean.

## 2. Existing Typography Audit

`grep` for `font-family`/`fontFamily` across all of `apps/web` found **zero** explicit declarations anywhere in application code — typography was already centralized, not scattered. `font-sans`/`font-mono` usage found in exactly 4 places: `globals.css` (the token definitions) and three Settings components (`two-factor-manager.tsx`, `mcp-session-manager.tsx`, `ai-provider-manager.tsx`) using `font-mono` for masked API keys, MCP tokens, and TOTP secrets/backup codes — legitimate technical exceptions, not stray overrides. No `tailwind.config.*` file exists (pure Tailwind v4 CSS-first config via `@theme`), so `globals.css`'s `@theme inline` block is the one and only place a global font token could live.

## 3. Previous Font Architecture — and a Real Defect Found In It

`layout.tsx` loaded `Geist`/`Geist_Mono` via `next/font/google`, naming their CSS variables `--font-geist-sans`/`--font-geist-mono`. `globals.css`'s `@theme inline` block defines `--font-sans: var(--font-sans)` (Tailwind v4's standard self-referencing pattern — the theme layer stays generic, and whatever the app defines directly on the DOM is what gets picked up) and `--font-heading: var(--font-sans)`.

**These never matched.** `--font-geist-sans` ≠ `--font-sans` — the self-reference had nothing to resolve against. Confirmed live via `getComputedStyle(document.body).fontFamily`, which returned **`"Times"`** (the browser's absolute serif fallback) before any change was made — the entire application had been silently rendering in the browser's default font, not Geist, for an unknown prior period. This was not caused by, and predates, this phase; it is disclosed here because implementing the requested migration correctly required understanding and fixing it.

## 4. Google Sans Flex Implementation

Confirmed genuinely available in this installed Next.js version's Google Fonts data (`next/dist/compiled/@next/font/dist/google/font-data.json` lists `"Google Sans Flex"` as a real entry — a variable font, weight axis 1–1000, plus optical-size/grade/rounding/slant/width axes). Loaded via `next/font/google`'s `Google_Sans_Flex` export — the exact same self-hosted, build-time, zero-runtime-request mechanism Geist already used. No new dependency, no third-party font source, no manually downloaded font files.

## 5. Global Token Change

One line changed the token's actual value: `Google_Sans_Flex({ variable: "--font-sans", subsets: ["latin"] })`, replacing `Geist({ variable: "--font-geist-sans", ... })`. Naming the loader's variable `--font-sans` directly — rather than inventing a third distinctly-named variable and having to also edit `globals.css` — is what makes this a true single-file change: it fixes the naming-mismatch defect (§3) and completes the migration in the same edit, because `globals.css`'s existing self-referencing `--font-sans: var(--font-sans)` now has something real to resolve.

## 6. Tailwind Change

**None needed.** `font-sans` and `font-heading` are Tailwind utility classes generated from the `@theme inline` block's tokens — since that block was already correctly structured (just pointed at an undefined variable), fixing the variable name at the source made every existing `font-sans`/`font-heading` usage across the entire application resolve to Google Sans Flex automatically. Zero component files were touched.

## 7. Font Loading Strategy

Unchanged architecture: `next/font/google`, self-hosted at build time (fonts are downloaded once during the build and served from this app's own origin — no runtime request to Google's font CDN, no render-blocking external `<link>` tag, no CLS risk from a third-party font swap). One harmless build-time warning was observed and is disclosed rather than hidden: *"Failed to find font override values for font `Google Sans Flex` / Skipping generating a fallback font."* This means Next's internal font-metrics database doesn't yet have precomputed fallback-matching metrics for this specific (newer) font — Next still loads and serves the real font correctly; it just can't generate its usual near-invisible "ghost" fallback font for the brief loading window. Not a correctness or security issue, and not something fixable from within this repository (it depends on Next.js's own upstream metrics database).

## 8. Typography Hierarchy

Unchanged. Heading/body/label/caption/button size and weight differences are, and remain, separate Tailwind utility classes per element (`text-xl font-semibold`, `text-sm text-muted-foreground`, etc.) — never a different font family. Swapping only the underlying `--font-sans` value preserves every existing size/weight relationship exactly.

## 9. Financial Number Treatment

`components/spencare/money.tsx`'s `tabular-nums` utility (`font-variant-numeric: tabular-nums`) was not touched — it is an independent CSS property that any font, including Google Sans Flex, respects. Verified no other numeric-formatting logic exists to disturb.

## 10. Exceptions

Geist Mono remains the monospace font for: masked AI provider API keys (Settings → AI), MCP session tokens (Settings → MCP), and TOTP secrets/backup codes (Settings → Security). These are the only three places `font-mono` is used in the entire application, and all three are legitimate technical/credential-display cases per the mandate's own carve-out — none were changed.

## 11. Login/Signup Verification

Live-verified in-browser: both pages render correctly, computed `font-family` on body/headings resolved to `"Google Sans Flex"`, the "Continue with Google" button retains its exact Phase 19 solid-purple treatment (untouched), zero console errors on a fresh tab, layout/spacing/card structure identical to before.

## 12. Dashboard Verification

`/home` live-verified: Safe-to-Spend card, welcome heading, Ask Spensa card, and the three setup-checklist cards all render correctly with the new font, no wrapping regressions, no overflow.

## 13. Spensa Verification

`/spensa/new` live-verified: empty-state heading/description, chat input, and navigation rail all render correctly.

## 14. Settings Verification

Live-verified: `/settings/mcp` (including badges, the token-created/last-used metadata line, and the previously-revoked test token's "Revoked" badge still rendering correctly), `/settings/gmail` (bulleted permission lists, "Connect Gmail" button), `/settings/ai` (provider radio cards including "Coming soon" badges), `/settings/accounts` (empty state). Settings nav and shell unaffected.

## 15. Gmail Verification

Covered under §14 — Gmail Settings/connection UI renders correctly with the new font. No Gmail ingestion, OAuth, or sync behavior was touched (none of this phase's changes could affect that code path at all — it is a `layout.tsx`-only change).

## 16. MCP Verification

Covered under §14 — MCP Settings UI (token generation form, active-tokens list) renders correctly. No MCP protocol/server behavior was touched.

## 17. Responsive Verification

Live-checked at 320px and 375px (home and Settings → MCP): `document.documentElement.scrollWidth` equals `clientWidth` at both widths — **zero horizontal overflow**. Text wraps naturally (e.g. "Welcome, Phase22 Test" correctly wraps to two lines at 375px without clipping). No new mobile layout was invented; existing responsive classes were untouched.

## 18. Accessibility

The existing `axe`-based test suite (embedded throughout the 537-test full regression — signup form, transaction/goal/bill/budget forms, Gmail candidate manager, etc.) was re-run fresh and passes unchanged. A font-family swap alone does not affect color contrast, focus states, ARIA attributes, or touch-target sizing, none of which this phase touched.

## 19. Browser Verification

Performed for real, not inferred from source: `getComputedStyle(document.body).fontFamily` and `getComputedStyle(document.documentElement).getPropertyValue('--font-sans')` both confirmed `"Google Sans Flex"` live, on a genuinely fresh browser tab (the established lesson from earlier phases — a reused tab's console/computed-style history can be stale — was applied here too). `font-mono` computed style confirmed still `"Geist Mono", "Geist Mono Fallback"`.

## 20. Tests

537 tests across 60 files (up from 532/59), including 5 new source-level regression tests (`app/layout.test.ts`) pinning the exact invariants that silently broke before this phase (variable-name pairing, family import, className application, Geist Mono preservation, no bare-Geist-Sans reintroduction). All passing.

## 21. Build

Clean production `next build`, one disclosed harmless warning (§7). Every route still builds, including `/api/mcp` and `/api/cron/gmail-sync` from prior phases.

## 22. Typecheck

Zero errors across all 12 monorepo typecheck tasks.

## 23. Lint

Zero errors; only the same 3 pre-existing, unrelated React-Compiler warnings present since before this phase.

## 24. Conformance

`dependency-cruiser`: zero violations, 1690 modules / 3245 dependencies (a font-loader change touches no package boundary at all).

## 25. Defects Found

The `--font-geist-sans` / `--font-sans` naming mismatch (§3) — a genuine, pre-existing, previously-undetected defect causing the entire application to silently render in the browser's default font.

## 26. Defects Fixed

The same defect, fixed as an inherent consequence of implementing the requested migration correctly (§4–§5) — not a separate, additional change.

## 27. Remaining Issues

None known. The one disclosed build warning (§7) is cosmetic/informational, not a defect, and not fixable from within this repository.

## 28. Files Changed

- `apps/web/app/layout.tsx` (modified — the entire migration)
- `apps/web/app/layout.test.ts` (new — regression guard)

No other file was touched. No `.env` file, no credential, no generated file, no `.claude/` content, no unrelated refactor.

## 29. Commit Hash

`792a0d5`

## 30. Final Status

---

# PHASE 23 STATUS:
# COMPLETE

# GOOGLE SANS FLEX:
# GLOBAL APPLICATION FONT — VERIFIED
