# Gate 3 — Authenticated Financial Dashboard: Validation Report

**Branch:** `mobile-foundation`  
**Date:** 2026-10-19  
**Status:** ✅ PASSED

---

## What Was Built

Gate 3 delivers a fully-authenticated financial dashboard for the Spencare Android native app. The implementation spans three layers:

1. **Dashboard API route** (`apps/web/app/api/mobile/dashboard/route.ts`) — a new GET endpoint that authenticates mobile clients via Bearer token, calls the domain layer `getDashboardSummary` query, and returns serialized financial data with a `privacyMode` flag.

2. **Mobile API client** (`apps/mobile/lib/api.ts`) — TypeScript interfaces for all dashboard response shapes (`MoneyJSON`, `SafeToSpendJSON`, `AccountJSON`, `GoalJSON`, `BillJSON`, `CashFlowJSON`, `NetWorthJSON`, `DashboardResponse`) and a `getDashboard(accessToken)` method.

3. **Bottom tab navigation** (`apps/mobile/app/(protected)/_layout.tsx`) — converted from a Stack to a 4-tab layout (Home, Transactions, Goals, Profile) with an auth guard that redirects unauthenticated users to sign-in.

4. **Dashboard home screen** (`apps/mobile/app/(protected)/home.tsx`) — shows Safe-to-Spend (hero card), accounts list, cash flow (income / expense / net), goals with progress bars, and upcoming bills. Supports loading, error, pull-to-refresh, and privacy mode states.

5. **Stub screens** — `transactions.tsx`, `goals.tsx` (Coming soon placeholders), and `profile.tsx` (email display + sign-out).

---

## Financial Correctness Invariants Verified

| Rule | Verification |
|------|-------------|
| Safe-to-Spend = availableBalance − bills − goalReserved | Test: `safe-to-spend = availableBalance minus reservations` ✅ |
| Net cash flow = income − expense | Test: `net cash flow = income - expense` ✅ |
| Net worth = totalAssets − totalLiabilities | Test: `net worth = totalAssets - totalLiabilities` ✅ |
| Archived accounts excluded from display | Test: `filters archived accounts out of visible list` ✅ |
| Only active goals shown in goals section | Test: `only shows active goals in the goals section` ✅ |
| Goal progress capped at 100% | Test: `goal progress percentage is bounded [0, 100]` ✅ |
| MoneyJSON minor→major conversion (INR ÷ 100) | Test: `parses minor units to major correctly for INR` ✅ |
| Negative amounts handled (overdraft) | Test: `handles negative amounts (overdraft / deficit)` ✅ |
| Privacy mode masks all amounts | Test: `privacyMode: true => all amounts masked` ✅ |
| No API call without a session | Test: `state machine: no session => never calls api.getDashboard` ✅ |

---

## Security Invariants Verified

| Rule | Implementation |
|------|---------------|
| `SUPABASE_SERVICE_ROLE_KEY` never in browser | Dashboard route is server-only; service client is created inside the route handler |
| Bearer token validated server-side | `anonClient.auth.getUser(accessToken)` before any data access |
| User ID derived from validated token, never trusted from client | `userData.user.id` from Supabase auth response |
| RLS-scoped user client created after validation | Second `createClient` with `Authorization` header; auth refresh disabled |
| No cross-user data access | `getDashboardSummary(ctx)` uses RLS-scoped client, not service role |

---

## Test Results

### Mobile Jest (jest-expo preset)
```
Test Suites: 1 passed
Tests:       34 passed
```
Covers: MoneyJSON parsing, dashboard financial rules, privacy mode, auth session guard.

### Web API Route (Vitest)
```
Test Files: 1 passed
Tests:       4 passed
```
Covers: 401 on missing auth header, 401 on invalid token, 200 with valid token, privacyMode flag.

### TypeScript
```
apps/mobile: 0 errors
apps/web:    0 errors
```

---

## Emulator Verification

- **Device:** Android emulator-5554 (Pixel 8 API 35)
- **Metro:** PID 76213, port 8083
- **Bundle result:** Loaded successfully — no `@expo/vector-icons` resolution errors
- **Auth guard:** Unauthenticated launch correctly redirects to the sign-in screen (screenshot captured 2026-10-19)
- **Sign-in screen:** Renders "Spencare / Personal finance, clearly." with email/password fields and Sign in button

The tab navigation and dashboard screen are behind the auth gate by design — they render once the user signs in with a valid Spencare account.

---

## Files Changed

| File | Status |
|------|--------|
| `apps/web/app/api/mobile/dashboard/route.ts` | Created |
| `apps/web/app/api/mobile/dashboard/route.test.ts` | Created |
| `apps/mobile/lib/api.ts` | Modified (interfaces + getDashboard) |
| `apps/mobile/app/(protected)/_layout.tsx` | Replaced (Stack → Tabs) |
| `apps/mobile/app/(protected)/home.tsx` | Replaced (full dashboard screen) |
| `apps/mobile/app/(protected)/transactions.tsx` | Created (stub) |
| `apps/mobile/app/(protected)/goals.tsx` | Created (stub) |
| `apps/mobile/app/(protected)/profile.tsx` | Created |
| `apps/mobile/__tests__/dashboard.test.ts` | Created |

---

## Known Limitations / Gate 4 Scope

- Tab icons use Unicode glyphs (⌂ ↔ ⚑ ◎) because `@expo/vector-icons` is not linked in this dev build's node_modules. Gate 4 should resolve the icon package or adopt a linked alternative.
- Transactions, Goals detail, and Budget screens are stubs — Gate 4 will implement them.
- The dashboard makes a live API call to the configured `EXPO_PUBLIC_API_URL`; local dev requires the Next.js dev server to be running and accessible from the emulator.
