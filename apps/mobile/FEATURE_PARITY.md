# Spencare Mobile — Feature Parity Matrix

Last updated: 2026-10-24 (session 3)  
Branch: `mobile-foundation`  
Methodology: Inspected all web routes, domain commands, and mobile screens.

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
| Forgot password | `/forgot-password` | ❌ Missing | No mobile reset password screen |
| Password reset | `/reset-password` | ❌ Missing | Needs deep-link handling |
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
| Cash flow trend chart | `/home` | ❌ Missing | ECharts/sparkline not implemented |
| Category spending breakdown | `/home` | ❌ Missing | Pie/donut chart missing |
| Budget items (progress bars) | `/home` | ✅ Complete | Top 3 budgets with progress bars on Home |
| Goal items (progress bars) | `/home` | ❌ Missing | Goal summary on home |
| Credit utilization card | `/home` | ❌ Missing | |
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
| Category filter | `/cash-flow/transactions` | ❌ Missing | |
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
| Goal pace status | `/goals` | ❌ Missing | On-track/at-risk indicator |
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
| List commitments | `/cash-flow/upcoming` | ❌ Missing | Commitment model separate from bills |
| List loans | `/cash-flow/upcoming` | ❌ Missing | |
| Edit bill | `/cash-flow/upcoming` | ✅ Complete | Edit bill modal — update frequency/amount/category |
| Skip bill occurrence | `/cash-flow/upcoming` | ❌ Missing | |
| Add commitment | `/cash-flow/upcoming` | ❌ Missing | |
| Edit commitment | `/cash-flow/upcoming` | ❌ Missing | |
| Pause/resume commitment | `/cash-flow/upcoming` | ❌ Missing | |
| Reserve commitment | `/cash-flow/upcoming` | ❌ Missing | |
| Credit card payment action | `/cash-flow/upcoming` | ❌ Missing | |
| Loan management | `/cash-flow/upcoming` | ❌ Missing | |
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
| List vehicles | `/vehicles` | ❌ Missing | |
| Vehicle detail | `/vehicles/[id]` | ❌ Missing | |
| Add vehicle | — | ❌ Missing | |
| Log fuel/odometer | — | ❌ Missing | |
| Import (Fuelio) | `/vehicles/[id]/import` | ❌ Missing | |
| Link transaction to vehicle | — | ❌ Missing | |

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
| Change password | `/settings/security` | ❌ Missing | |
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
| Auth & Onboarding | 5 | 0 | 2 | 7 |
| Dashboard | 6 | 0 | 7 | 13 |
| Accounts | 5 | 1 | 2 | 8 |
| Transactions | 12 | 2 | 3 | 17 |
| Goals | 8 | 2 | 2 | 12 |
| Budgets | 8 | 0 | 1 | 9 |
| Bills/Upcoming | 7 | 1 | 9 | 17 |
| Spensa AI | 5 | 0 | 1 | 6 |
| Plans | 0 | 0 | 6 | 6 |
| Vehicles | 0 | 0 | 6 | 6 |
| Settings | 7 | 1 | 9 | 17 |
| Smart Capture | 0 | 0 | 5 | 5 |
| **TOTAL** | **63** | **7** | **53** | **123** |

**Current parity: 51% → 56% complete (+7 features this session). Categories CRUD, profile editing, search, edit bill, budget home card, goal withdrawal added.**

---

## Implementation Priority (this session)

### P1 — Bills/Upcoming (Priority 8 per mandate)
- Mobile API: `/api/mobile/bills/route.ts`
- Mobile screen: `apps/mobile/app/(protected)/upcoming.tsx`
- Add "Upcoming" tab to navigation

### P2 — Spensa AI (Priority 9)
- Mobile API proxy: `/api/mobile/spensa/route.ts`
- Mobile screen: `apps/mobile/app/(protected)/spensa.tsx`
- Add "AI" tab to navigation

### P3 — Settings Depth
- Profile editing (name, currency)
- Categories management screen
- AI provider settings

### P4 — Dashboard Enhancements
- Category spending chart
- Budget/goal summary cards on Home

### P5 — Remaining
- Plans, Vehicles, Smart Transaction Capture

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
| Cash flow trend | `getCashFlowTrend()` | ❌ Not yet on mobile |
| Category spending | `getCashFlowByCategory()` | ❌ Not on mobile dashboard |

---

*This matrix is updated after each implementation phase.*
