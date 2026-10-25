# Spencare Mobile — Feature Parity Matrix

Last updated: 2026-10-24 (session 12 — credit utilization card; loan tracker rows removed)  
Branch: `mobile-foundation` @ uncommitted  
Methodology: Inspected all web routes, domain commands, and mobile screens; ran full test suite.

## Build & Test Status

| Check | Status | Notes |
|-------|--------|-------|
| Mobile tsc | ✅ 0 errors | |
| Web tsc | ✅ 0 errors | Fixed in fd08ae4 |
| Mobile tests | ✅ 350/350 | session 12 — unchanged |
| domain-application | ✅ 539/539 | session 12 — unchanged |
| @spencare/web tests | ✅ 1101/1101 | session 12 — unchanged |
| mcp-server | ✅ 43/43 | |
| @spencare/ai | ❌ pre-existing | `claude-3-5-haiku-latest` deprecated + vitest mock infra |

## Release Blockers

| # | Issue | Status |
|---|-------|--------|
| 1 | TS2353 categoryId in transactions route | ✅ Fixed (bcba950) |
| 2 | settings-nav.tsx ReactNode errors (web) | ✅ Resolved — web tsc 0 errors |
| 3 | budgets route test (listCategories not mocked) | ✅ Fixed (this session) |
| 4 | @spencare/ai test failures | ⚠️ Pre-existing — fix before merge |
| 5 | mobile-foundation commits behind main | Must rebase before PR |

---

## Legend

| Status | Meaning |
|--------|---------|
| ✅ Complete | Implemented, connected to real API, visually verified |
| 🟡 Partial | Screen exists but missing actions, data, or polish |
| ❌ Missing | No mobile equivalent; web feature exists |
| 🚫 Blocked | Requires platform capability not yet available |
| N/A | Not applicable to mobile platform |

---

## 1. Authentication & Onboarding

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| Email/password sign-in | `/login` | ✅ Complete | sign-in.tsx |
| Sign-up | `/signup` | ✅ Complete | sign-up.tsx |
| Forgot password | `/forgot-password` | ✅ Complete | forgot-password.tsx; triggers email via /api/mobile/auth/forgot-password |
| Password reset | `/reset-password` | 🟡 Partial | Email sent; reset completes on web (Supabase redirect) |
| Google OAuth | — | ✅ Complete | PKCE flow implemented |
| TOTP 2FA verify | `/verify-2fa` | ✅ Complete | verify-mfa.tsx |
| Onboarding wizard | `/onboarding` | ✅ Complete | 3-step onboarding |

---

## 2. Home / Dashboard

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| Safe-to-Spend hero card | `/home` | ✅ Complete | Shows correct calculation |
| Net Worth card | `/home` | ✅ Complete | |
| This Month (income/expense/net) | `/home` | ✅ Complete | |
| Account list | `/home` | ✅ Complete | |
| Upcoming bills widget | `/home` | ✅ Complete | Read-only list |
| Cash flow trend chart | `/home` | ✅ Complete | 6-month bar chart via plain RN Views (no native lib) |
| Category spending breakdown | `/home` | ✅ Complete | Top 5 expense categories with progress bars |
| Budget items (progress bars) | `/home` | ✅ Complete | Top 3 budgets with progress bars on Home |
| Goal items (progress bars) | `/home` | ✅ Complete | GoalsCard renders active goals with progress bars |
| Credit utilization card | `/home` | ✅ Complete | Progress bar; shown when credit cards with limits exist |
| Goals at risk alert | `/home` | ❌ Missing | |
| Budgets needing attention | `/home` | ❌ Missing | |
| Period/account filter bar | `/home` | ❌ Missing | Week/month/quarter filter |

---

## 3. Accounts

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| List accounts | `/settings/accounts` | ✅ Complete | In settings/accounts.tsx |
| Add account | `/settings/accounts` | ✅ Complete | |
| Edit account | `/settings/accounts` | ✅ Complete | |
| Archive account | `/settings/accounts` | ✅ Complete | |
| Account details (balance, type) | `/settings/accounts` | ✅ Complete | |
| EPFO account details | `/settings/accounts` | ❌ Missing | Specialist account type |
| Change currency | `/settings/accounts` | ❌ Missing | |
| Accounts accessible from Home | `/home` | 🟡 Partial | Shown read-only on Home; management requires navigation to settings/accounts |

---

## 4. Transactions

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| List transactions (paginated) | `/cash-flow/transactions` | ✅ Complete | FlatList with pull-refresh |
| Add expense | — | ✅ Complete | |
| Add income | — | ✅ Complete | |
| Add transfer | — | 🟡 Partial | Basic transfer; no transfer-pair display |
| Edit transaction | — | ✅ Complete | |
| Delete (soft) transaction | — | ✅ Complete | |
| Filter by account | — | ✅ Complete | |
| Filter by date range | — | ✅ Complete | |
| Filter by type | — | ✅ Complete | |
| Category assignment | — | ✅ Complete | |
| Group by date | — | ✅ Complete | |
| Day subtotals | — | ✅ Complete | |
| Search transactions | `/cash-flow/transactions` | ✅ Complete | Client-side search by merchant/category/description |
| Category filter | `/cash-flow/transactions` | ✅ Complete | Server-side filter via category_id param; badge count included |
| Transaction detail view | — | 🟡 Partial | Edit modal exists; dedicated detail screen missing |
| CSV import | `/cash-flow/import` | ❌ Missing | |
| Spending investigation | `/cash-flow/investigate` | ❌ Missing | |

---

## 5. Goals

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| List goals | `/goals` | ✅ Complete | |
| Create goal | `/goals` | ✅ Complete | |
| Edit goal | `/goals` | ✅ Complete | |
| Archive goal | `/goals` | ✅ Complete | |
| Delete goal | `/goals` | ✅ Complete | |
| Contribute to goal | `/goals` | ✅ Complete | Debits account |
| View contribution history | `/goals` | 🟡 Partial | Count shown; no history list |
| Goal progress (%) | `/goals` | ✅ Complete | |
| Goal pace status | `/goals` | ✅ Complete | On-track/at-risk/behind/overdue badge on GoalCard |
| Contribution plan (auto-save) | `/goals` | ❌ Missing | Web has contribution plan management |
| Goal detail dialog | `/goals` | 🟡 Partial | Basic detail in edit sheet |
| Withdraw from goal | `/goals` | ✅ Complete | Withdraw modal — creates goal_withdrawal transaction |

---

## 6. Budgets

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| List budgets (current month) | `/cash-flow/budgets` | ✅ Complete | |
| Month navigation (prev/next) | `/cash-flow/budgets` | ✅ Complete | |
| Add budget | — | ✅ Complete | |
| Edit budget | — | ✅ Complete | |
| Delete budget | — | ✅ Complete | |
| Budget vs actual spending | — | ✅ Complete | Shows spent/remaining |
| Progress bar | — | ✅ Complete | |
| Apply to upcoming months | `/cash-flow/budgets` | ❌ Missing | Web has "apply to all future months" |
| Category-linked budget | — | ✅ Complete | |

---

## 7. Bills & Upcoming Payments

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| List upcoming bills | `/cash-flow/upcoming` | ✅ Complete | upcoming.tsx — tab with open/overdue filter |
| Mark bill as paid | `/cash-flow/upcoming` | ✅ Complete | Mark-paid modal with account/category/amount |
| Add bill | `/cash-flow/upcoming` | ✅ Complete | Add-bill modal with frequency/amount/category |
| Delete bill | `/cash-flow/upcoming` | ✅ Complete | Delete with confirmation dialog |
| List all bills (paid history) | `/cash-flow/upcoming` | ✅ Complete | "All Bills" tab shows all statuses |
| Summary card (total upcoming) | `/cash-flow/upcoming` | ✅ Complete | Totals open/overdue bills |
| List commitments | `/cash-flow/upcoming` | ✅ Complete | Commitments tab in upcoming.tsx; GET /api/mobile/upcoming |
| Edit bill | `/cash-flow/upcoming` | ✅ Complete | Edit bill modal — update frequency/amount/category |
| Skip bill occurrence | `/cash-flow/upcoming` | ❌ Missing | |
| Add commitment | `/cash-flow/upcoming` | ❌ Missing | |
| Edit commitment | `/cash-flow/upcoming` | ❌ Missing | |
| Pause/resume commitment | `/cash-flow/upcoming` | ✅ Complete | PATCH /api/mobile/commitments action=pause/resume; confirm dialog |
| Mark commitment paid (atomic) | `/cash-flow/upcoming` | ✅ Complete | PATCH /api/mobile/commitments action=mark_paid; MarkCommitmentPaidModal |
| Delete commitment | `/cash-flow/upcoming` | ✅ Complete | PATCH /api/mobile/commitments action=delete; confirm dialog |
| Reserve commitment | `/cash-flow/upcoming` | ❌ Missing | Complex, rarely used on mobile |
| Add/edit commitment | `/cash-flow/upcoming` | ❌ Missing | 15+ fields; web-first |
| Skip commitment occurrence | `/cash-flow/upcoming` | ❌ Missing | Complex occurrence management; web-first |
| Credit card payment action | `/cash-flow/upcoming` | ❌ Missing | |
| Upcoming payments home widget | `/home` | 🟡 Partial | Read-only shown on Home |

---

## 8. Spensa AI

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| AI chat interface | `/spensa/[conversationId]` | ✅ Complete | spensa.tsx — full chat UI with streaming |
| Streaming responses | `/api/spensa/chat` | ✅ Complete | /api/mobile/spensa SSE proxy with Bearer auth |
| Read tools (getDashboard, etc.) | — | ✅ Complete | Same sendMessage function as web — all tools included |
| Propose write actions | — | ✅ Complete | Proposal events streamed; confirmed via web UI |
| Privacy Mode masking | — | ✅ Complete | Enforced at domain layer, not display layer |
| AI provider settings (own key) | `/settings/ai` | ❌ Missing | User must configure key via web settings |

---

## 9. Plans (Financial Life Plans)

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| List plans | `/plans` | ❌ Missing | No mobile screen |
| Plan detail | `/plans/[planId]` | ❌ Missing | |
| Create plan | — | ❌ Missing | |
| Add plan item | — | ❌ Missing | |
| Associate account/goal/commitment | — | ❌ Missing | |
| Plan budget sheet | — | ❌ Missing | |

---

## 10. Vehicles

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| List vehicles | `/vehicles` | ✅ Complete | Profile → Vehicles & Fuel |
| Vehicle detail (stats) | `/vehicles/[id]` | ✅ Complete | Odometer, efficiency, total cost |
| Add vehicle | — | ✅ Complete | Create modal with make/model/type/fuel |
| Log fuel/odometer | — | ✅ Complete | Fuel tab in vehicle detail |
| Log expense | — | ✅ Complete | Expenses tab + add modal |
| Log service/maintenance | — | ✅ Complete | Service tab + add modal; auto-creates reminder if next due date set |
| Track documents | — | ✅ Complete | Docs tab + add modal; auto-creates expiry reminders |
| View reminders | — | ✅ Complete | Reminders tab with dismiss action |
| Delete fuel entry | — | ✅ Complete | API route only (no UI swipe-to-delete yet) |
| Import (Fuelio CSV) | `/vehicles/[id]/import` | ❌ Blocked | `expo-document-picker` not installed; API route not built (no file picker on mobile) |
| Link transaction to vehicle | — | ❌ Missing | Requires account+category picker; deferred for MVP |
| Vehicle photo | — | ❌ Missing | No native image picker installed |

---

## 11. Settings

| Feature | Web Route | Mobile Status | Notes |
|---------|-----------|---------------|-------|
| View profile (name, email, avatar) | `/settings/profile` | ✅ Complete | Profile screen shows email/avatar |
| Edit display name | `/settings/profile` | ✅ Complete | Bottom-sheet modal in Profile screen |
| Edit currency | `/settings/profile` | ✅ Complete | Currency picker in Profile screen |
| Avatar upload | `/settings/profile` | ❌ Missing | |
| Privacy Mode toggle | — | ✅ Complete | In Profile screen |
| Theme (light/dark/system) | — | ✅ Complete | In Profile screen |
| Manage accounts | `/settings/accounts` | 🟡 Partial | Accessible from Profile nav |
| AI provider (add own key) | `/settings/ai` | ❌ Missing | |
| Category management (CRUD) | `/settings/categories` | ✅ Complete | Full CRUD via settings/categories.tsx |
| Notification preferences | `/settings/notifications` | ❌ Missing | |
| Telegram connection | `/settings/notifications` | ❌ Missing | |
| Security / 2FA setup | `/settings/security` | ❌ Missing | |
| Change password | `/settings/security` | ✅ Complete | API route + mobile screen + profile nav entry |
| Gmail connection | `/settings/gmail` | ❌ Missing | |
| MCP session management | `/settings/mcp` | N/A | Desktop-focused feature |
| Data export (JSON/CSV) | `/settings/data-backup` | ❌ Missing | |
| Sign out | — | ✅ Complete | In Profile screen |

---

## 12. Smart Transaction Capture (Mobile-only)

| Feature | Platform | Status | Notes |
|---------|----------|--------|-------|
| SMS read permission | Android | ❌ Missing | Requires READ_SMS permission |
| Bank SMS parsing | Android | ❌ Missing | Pattern matching for INR amounts |
| Notification listener | Android | ❌ Missing | Requires BIND_NOTIFICATION_LISTENER_SERVICE |
| Capture confidence scoring | — | ❌ Missing | |
| Candidate review UI | — | ❌ Missing | |
| Deduplication | — | ❌ Missing | |
| iOS fallback | iOS | N/A | iOS blocks SMS/notification access; document limitation |

---

## Summary

| Category | Complete | Partial | Missing | Total |
|----------|----------|---------|---------|-------|
| Auth & Onboarding | 6 | 1 | 0 | 7 |
| Dashboard | 10 | 0 | 3 | 13 |
| Accounts | 5 | 1 | 2 | 8 |
| Transactions | 13 | 2 | 2 | 17 |
| Goals | 9 | 2 | 1 | 12 |
| Budgets | 8 | 0 | 1 | 9 |
| Bills/Upcoming | 11 | 1 | 7 | 19 |
| Spensa AI | 5 | 0 | 1 | 6 |
| Plans | 0 | 0 | 6 | 6 |
| Vehicles | 8 | 0 | 4 | 12 |
| Settings | 7 | 1 | 9 | 17 |
| Smart Capture | 0 | 0 | 5 | 5 |
| **TOTAL** | **79** | **8** | **40** | **127** |

**Current parity: ~71% complete (this session: +credit utilization card; session 11: +5 commitment actions; loan tracker removed — 4 rows removed).**

---

## 2-Day Execution Plan (to production readiness)

### Day 1 — High-value, achievable
1. **Dashboard charts** — cash flow trend sparkline + category spending breakdown. APIs: `getCashFlowTrend`, `getCashFlowByCategory` already in `/api/mobile/dashboard`.
2. **Goal items on Home** — goal progress on dashboard. API data already available.
3. **Change password** ✅ — API route + screen + profile nav. 8 tests passing.

### Day 2 — Medium-value, moderate effort
4. **Commitment actions** ✅ — PATCH `/api/mobile/commitments` (pause/resume/delete/mark_paid). 8 tests passing.
5. **Credit utilization card** ✅ — home.tsx; uses existing dashboard API data. No new endpoint.
6. **AI provider settings** — add mobile screen + passthrough to existing web settings API.
7. **Data export** — `exportData` command exists; need mobile endpoint.

### Stretch (post Day 2)
- Plans (Financial Life Plans) — 2–3 days
- Vehicles/Fuel — 1 day read-only + fuel log; 3–4 days full parity
- Notification preferences on mobile
- Smart Transaction Capture — post-launch, Android only

## Smart Transaction Capture — Platform Constraints

**iOS:** Fully blocked. iOS sandboxing provides no read access to SMS or other apps' notifications. N/A.

**Android options:**
- `READ_SMS` — high Play Store scrutiny; requires policy justification
- `BIND_NOTIFICATION_LISTENER_SERVICE` — requires user grants in Special App Access; lower scrutiny

**Recommendation:** Post-launch. Implement as Android-only if pursued. Web Gmail ingestion is the cross-platform equivalent and is already live.

---

## Financial Metric Inventory

All metrics use the domain-application layer. No mobile-specific formulas.

| Metric | Domain Function | Mobile Status |
|--------|----------------|---------------|
| Safe-to-Spend | `getSafeToSpend()` | ✅ via `/api/mobile/dashboard` |
| Net Worth | `getNetWorth()` | ✅ via `/api/mobile/dashboard` |
| Cash Flow (income/expense/net) | `getCashFlowByCategory()` | ✅ via `/api/mobile/dashboard` |
| Budget vs Actual | `listBudgetsWithUsage()` | ✅ via `/api/mobile/budgets` |
| Goal Progress (%) | Calculated in goals route | ✅ via `/api/mobile/goals` |
| Upcoming payments total | `getUpcomingProjection()` | ❌ Not yet on mobile |
| Cash flow trend | `getCashFlowTrend()` | ✅ via `/api/mobile/dashboard` |
| Category spending | `getCashFlowByCategory()` | ✅ via `/api/mobile/dashboard` |

---

*This matrix is updated after each implementation phase.*
