# Spencare — Claude Code Project Context

This file is the permanent high-level context for all Claude Code sessions working in this
repository. It describes what Spencare is, how it is built, and the invariants that must be
preserved across every code change.

---

## 1. What Spencare Is

Spencare is a personal finance management application. It helps users track spending, manage
accounts, plan budgets, progress toward savings goals, manage recurring bills, and understand
their financial picture through an AI assistant called Spensa.

Spencare is a single-tenant app: every user manages their own financial data. There is no
shared ledger, no multi-tenant concept, and no bank sync — all data is manually recorded or
imported. The application is production-live at **https://spencare.vercel.app**.

---

## 2. Architecture Overview

```
GitHub (santhoshshanmugavel/spencare)
    ↓ push triggers deploy
Vercel (spencare.vercel.app)
    ↓ server-side reads/writes
Supabase (wjaxxoselhlbjrtuhqlq, ap-southeast-2)
    ↓ pg_cron calls Vercel hourly
Supabase pg_cron → /api/cron/daily-summary
    ↓ notifications sent to
Telegram Bot (@Spencare_bot)

External AI providers (user-supplied keys):
  Google Gemini, OpenAI, Anthropic Claude
Gmail OAuth (gmail.readonly — financial transaction extraction)
Microsoft Clarity (client-side analytics)
Resend (transactional email — integrated, currently disabled)
```

---

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.3 (App Router, React Server Components) |
| Runtime | React 19, TypeScript 5 |
| Styling | Tailwind CSS 4 + Sera design system (shadcn primitives, custom tokens) |
| Animations | Framer Motion |
| Charts | Apache ECharts 6 |
| Forms | React Hook Form + Zod v4 |
| Build | Turborepo 2 + pnpm 10 workspaces |
| Database | Supabase (PostgreSQL 17, pgvault, pg_cron, pg_net) |
| Auth | Supabase Auth (email/password, Google OAuth, TOTP 2FA) |
| Testing | Vitest + Testing Library + jest-axe |
| Linting | ESLint (eslint-config-next) |
| Type-checking | tsc --noEmit (all packages) |
| Conformance | dependency-cruiser (enforces package boundaries) |
| Node | ≥20 (production: 22.x on Vercel) |
| Package manager | pnpm 10.20.0 |

---

## 4. Monorepo Structure

```
spencare/
├── apps/
│   ├── web/                   ← Next.js app (Vercel production)
│   └── mcp-server/            ← stdio MCP server (local Claude Desktop use)
├── packages/
│   ├── ai/                    ← AI provider adapters + Spensa orchestration
│   ├── validation/            ← Zod schemas (shared across app + server)
│   └── domain/
│       ├── core/              ← Value objects: Money, enums, pure logic
│       ├── application/       ← Commands, queries, notification composers
│       └── infra/             ← Supabase repository implementations
├── supabase/
│   ├── config.toml            ← Local dev Supabase config
│   ├── migrations/            ← All schema migrations (chronological)
│   └── tests/                 ← pgTAP database tests
├── docs/                      ← Phase-by-phase reports (phases 21–39+)
├── Logos/                     ← Master design assets (SVGs, PNG)
├── CLAUDE.md                  ← This file
├── turbo.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── package.json
```

---

## 5. Web Application Architecture (`apps/web`)

Next.js App Router with the following route groups:

```
app/
├── (auth)/          ← Login, signup, forgot/reset password, 2FA verify
├── (legal)/         ← Terms, Privacy policy
├── home/            ← Dashboard (Safe-to-Spend, Net Worth, accounts, upcoming bills)
├── cash-flow/       ← Transactions, budgets, bills, CSV import
├── goals/           ← Savings goals
├── spensa/          ← AI chat (Spensa)
├── settings/        ← Profile, AI, accounts, privacy, security, data backup,
│                       MCP, Gmail, categories, notifications
├── onboarding/      ← First-run wizard
├── oauth/           ← MCP OAuth 2.1 authorization endpoints
├── auth/            ← Supabase auth callback, Gmail OAuth callback
├── verify-2fa/      ← TOTP two-factor authentication gate
├── api/
│   ├── cron/        ← Vercel/pg_cron scheduled jobs
│   │   ├── gmail-sync/        ← Daily Gmail financial extraction
│   │   ├── notifications/     ← Hourly notification checks
│   │   └── daily-summary/     ← Hourly daily-summary delivery (GET+POST)
│   ├── spensa/chat/ ← AI chat streaming endpoint
│   ├── mcp/         ← Remote MCP endpoint (OAuth 2.1 PKCE)
│   ├── notifications/         ← Notification CRUD, preferences, channel routes
│   └── telegram/webhook/      ← Telegram bot webhook receiver
└── .well-known/     ← MCP OAuth discovery endpoints
```

All data mutations go through **Server Actions** or **Route Handlers**. No client-side
Supabase writes bypass RLS.

---

## 6. Domain Package Architecture

### `packages/domain/core`
Pure value objects and types. No Supabase, no Next.js, no side effects.
- `Money` — exact minor-unit arithmetic with currency precision
- Transaction/account/goal/budget/bill types and enums
- `transactionDisplay.ts` — presentation helpers (display amounts, signs)

### `packages/domain/application`
Use-case orchestration. Imports from core and infra. No framework code.
- `commands/` — write operations (createTransaction, confirmCommand, gmailSync…)
- `queries/` — read operations
- `notifications/messageComposer.ts` — Spensa notification message templates
- All financial calculations happen here. AI never recalculates.

### `packages/domain/infra`
Supabase repository implementations. Each repo wraps one DB table or RPC.
- Generated types: `generated/database.types.ts` — regenerate with Supabase MCP
- Repositories: accounts, transactions, goals, bills, budgets, notifications, gmail, MCP sessions, AI provider credentials

### Package boundary rules (enforced by dependency-cruiser)
- `core` → nothing (pure)
- `application` → core, infra
- `infra` → core only (no application)
- `apps/web` → all packages
- `apps/mcp-server` → all packages

---

## 7. Supabase Architecture

### Production project
- Project ref: `wjaxxoselhlbjrtuhqlq`
- Region: ap-southeast-2 (Sydney)
- PostgreSQL 17.6

### Key extensions
- `pg_cron` — hourly scheduler (primary daily-summary trigger)
- `pg_net` — HTTP calls from within PostgreSQL (pg_cron → Vercel)
- `pgvault` (Supabase Vault) — encrypted secret storage for pg_cron secrets

### Schema overview
Core tables: `profiles`, `accounts`, `transactions`, `categories`, `budgets`, `goals`,
`goal_contributions`, `bills`, `bill_payments`

Gmail tables: `gmail_connections`, `gmail_financial_candidates`

AI tables: `ai_provider_credentials`

MCP tables: `mcp_sessions`, `mcp_oauth_clients`, `mcp_oauth_codes`, `mcp_oauth_tokens`

Notification tables: `notifications`, `notification_deliveries`, `notification_preferences`,
`channel_connections`, `telegram_link_tokens`

Security tables: `security_settings`, `pending_confirmations`, `rate_limit_requests`

### RLS (Row Level Security)
Every user-owned table has RLS enabled. Policies use `auth.uid()` to scope all reads and
writes to the authenticated user. The service-role client bypasses RLS and is used ONLY for
server-side operations that legitimately need cross-user access (admin operations, cron jobs,
Gmail sync, notification delivery).

**Service-role must never reach the browser.** `SUPABASE_SERVICE_ROLE_KEY` has no
`NEXT_PUBLIC_` prefix and Next.js never bundles it client-side.

### Migrations
All schema changes are represented as versioned SQL files in `supabase/migrations/`.
Naming: `YYYYMMDDNNNNNN_description.sql`.
- Never edit an already-applied migration.
- New migrations are additive; destructive operations require explicit `DROP`/`ALTER` in a new file.
- Always apply locally before production.

---

## 8. Authentication

- Email/password via Supabase Auth
- Google OAuth (social login, separate from Gmail ingestion)
- TOTP 2FA (via `security_settings` table, encrypted with `TOTP_ENCRYPTION_KEY`)
- Session managed by Supabase SSR (`@supabase/ssr`) via middleware cookie refresh
- MCP sessions use their own Bearer token flow (stored in `mcp_sessions`)
- Gmail OAuth uses a separate Google Cloud client (different redirect URI from social login)

---

## 9. Financial Correctness Rules

These rules are **invariants**. Every code path must preserve them.

### Transaction model
- `amount_minor` — stored as integer minor units (e.g. ₹500 = `50000`)
- `occurred_at` — the user-supplied date/time of the transaction (not created_at)
- `created_at` — when the row was inserted (different concept)
- `type` enum: `income`, `expense`, `transfer`, `goal_contribution`, `goal_withdrawal`
- `deleted_at` — soft delete; exclude with `.is("deleted_at", null)`
- `transfer_pair_id` — links the two legs of a transfer; exclude transfer legs from income/expense calculations

### What counts as income/expense
```
income:  type = 'income'  AND deleted_at IS NULL AND transfer_pair_id IS NULL
expense: type = 'expense' AND deleted_at IS NULL AND transfer_pair_id IS NULL
```
Goal contributions, goal withdrawals, and transfer legs are **never** income or expense.

### Transfers
A transfer between accounts creates **two** rows (debit + credit) linked by `transfer_pair_id`.
Transfers are neither income nor expense. Never count transfer rows in spending or income totals.
Credit-card repayments are transfers (not spending).

### Credit cards
- A credit-card purchase is an `expense` (real spending) + creates a liability
- The credit available is **not** owned money — never include in Safe-to-Spend or Net Worth assets
- Credit-card repayment: `transfer` from bank → credit card (reduces liability, not new spending)

### Safe-to-Spend
= sum of `bank` + `cash` account balances only
- Does NOT include credit available
- Does NOT include investment accounts
- Upcoming bills deduct from the display value (prediction layer)

### Net Worth
= total assets − total liabilities
- Assets: bank, cash, investment account balances
- Liabilities: outstanding credit card balances (amount owed, not limit)
- Credit **limit** is never an asset

### Goal contributions
- "Already saved" metadata (the amount field filled in at goal creation) is informational only —
  it does NOT debit any account
- Actual `goal_contribution` transactions DO debit the funding account
- Do not double-count

### Money arithmetic
- Use `Money` value object from `@spencare/domain-core` for all arithmetic
- Never use floating-point for financial sums
- Store and read as integer minor units
- Display amounts use major units (divide by 100)

### MCP PATCH semantics
When Spensa proposes an update via MCP tools, only the explicitly supplied fields change.
Unset fields must not erase existing data. Always read the current row and merge changes.

---

## 10. Spensa AI Architecture

Spensa is the AI assistant. Key design rules:

- **No platform-wide AI API key.** Every user connects their own key via Settings → AI.
  Keys are encrypted at rest with `AI_PROVIDER_ENCRYPTION_KEY` (AES-256-GCM).
- Supported providers: Google Gemini (default), OpenAI, Anthropic Claude
- The `@spencare/ai` package abstracts all providers behind `AiProviderAdapter`
- Provider selection and key retrieval happen server-side in the `/api/spensa/chat` route
- `GEMINI_MODEL` env var overrides the default Gemini model (optional)

### What Spensa does and does not do
- **Does:** explain financial data, surface insights, propose write actions (propose-only)
- **Does not:** calculate financial truth — the domain layer calculates, Spensa explains
- **Does not:** confirm pending actions through chat — the user confirms in the UI
- **Does not:** have access to data the user cannot see themselves

### Tool architecture
- Read tools: getAccount, getDashboardSummary, getSafeToSpend, getNetWorth,
  searchTransactions, getBudgetStatus, getGoalProgress, getUpcomingBills, etc.
- Write tools (propose-only): proposeAddExpense, proposeAddIncome, proposeTransfer,
  proposeUpdateTransaction, proposeCreateGoal, etc.
- Propose tools insert a `pending_confirmations` row; the user confirms via UI action
- Privacy Mode: when active, all financial figures are masked before Spensa sees them

---

## 11. MCP Architecture

Two separate MCP deployments:

### 1. Remote MCP (`apps/web/app/api/mcp/route.ts`)
- Stateless HTTP MCP endpoint at `/api/mcp`
- Authenticated via per-user Bearer token (from Settings → MCP)
- OAuth 2.1 PKCE flow for external clients (Claude Desktop, etc.)
- Token stored in `mcp_sessions` table
- Exposes all Spencare tools to Claude Desktop / Claude Code

### 2. stdio MCP server (`apps/mcp-server/`)
- Standalone Node.js process for local Claude Desktop integration
- Uses its own env vars: `SPENCARE_SUPABASE_URL`, `SPENCARE_SERVICE_ROLE_KEY`, `SPENCARE_MCP_TOKEN`
- Separate from the web app (different deployment)

### `.mcp.json` (repo root)
Configures Claude Code's Supabase MCP integration (project-level tool access for development).
Does not contain secrets — only the Supabase project URL with features query param.

---

## 12. Gmail Ingestion

- Users connect Gmail via OAuth (gmail.readonly scope only)
- Tokens are encrypted at rest with `GMAIL_TOKEN_ENCRYPTION_KEY`
- Daily cron (`/api/cron/gmail-sync`, 06:00 UTC) scans recent emails
- AI (user's configured provider) extracts financial transactions from emails
- Extracted candidates shown to user in Settings → Gmail for accept/reject
- Accepted candidates become real transactions
- Connection stored in `gmail_connections` table
- Candidates stored in `gmail_financial_candidates` table

---

## 13. Notification Architecture

### Delivery channels
- **In-app** — always delivered (stored in `notifications` table, shown in bell icon)
- **Telegram** — opt-in (requires Telegram account connection)
- **Email** — integrated (Resend), currently disabled via `EMAIL_CHANNEL_ENABLED` env flag
- **Slack** — channel type defined in schema, not yet implemented

### Notification flow
1. Cron or event trigger calls `deliverNotification()` in `apps/web/lib/notifications/engine.ts`
2. Engine calls `composeNotificationMessage()` (domain/application) for Spensa-voiced text
3. Engine creates notification row (idempotent via `dedupe_key` unique index)
4. Engine checks user preferences (channel enabled, event type enabled, quiet hours)
5. Engine delivers to each enabled channel and records delivery status

### Daily summary
- pg_cron fires at top of every hour (`0 * * * *`)
- pg_cron reads `supabase_cron_secret` from Supabase Vault at runtime
- Calls `POST /api/cron/daily-summary` with `{"source":"pg_cron"}`
- Endpoint checks each user's local hour (derived from IANA timezone in `profiles`)
- Users whose local hour = 23 (23:00–23:59) receive their daily summary
- Dedupe key: `daily_summary:{userId}:{localDate}` — prevents duplicates
- Force mode: `POST` with `{"force": true, "userId": "..."}` bypasses hour check (for testing)
- Backup: Vercel daily cron at 21:00 UTC for any missed users

### Notification event types
Budget thresholds (50/80/90/100/over), balance warnings (low/zero/negative),
credit utilization (50/80/90/100), goal milestones (25/50/75/90/completed),
bill reminders (7d/3d/1d/due/overdue/changed), large/unusual transactions,
security events (password changed, new login, 2FA changed),
connection events (Gmail, MCP), daily/weekly/monthly summaries.

### Telegram bot
- Bot: `@Spencare_bot`
- Webhook registered at startup (instrumentation.ts) — idempotent
- Users connect via Settings → Notifications → Telegram deep link
- Messages use Telegram HTML formatting (bold, links)
- `TELEGRAM_BOT_TOKEN` — server-only, never NEXT_PUBLIC_
- `TELEGRAM_WEBHOOK_SECRET` — validates incoming webhook requests

---

## 14. Privacy Mode

A per-user toggle (stored in `profiles.privacy_mode`). When active:
- All financial figures in the UI are replaced with masked values
- Spensa receives masked figures — it cannot see or reconstruct real amounts
- Privacy Mode is enforced at the data layer, not just the display layer

---

## 15. Sera UI / Design System

Spencare uses a custom design system called Sera built on:
- Tailwind CSS 4 (CSS variables, no config file)
- shadcn/ui primitives (Button, Card, Sheet, Dialog, Form, etc.)
- Custom `components/spencare/` layer (NavigationRail, SettingsNav, DashboardSection, etc.)
- Google Sans Flex as primary typeface (loaded via Next.js font)
- `components.json` for shadcn configuration

Design tokens live in `apps/web/app/globals.css`. Never hardcode color values — always use
CSS variables. Dark mode is fully supported via `dark:` variants.

### Navigation
- `<NavigationRail>` — persistent left rail (desktop), bottom bar (mobile)
- `<SettingsNav>` — settings sub-navigation (left sidebar in settings area)
- `<SettingsShell>` — two-column settings layout wrapper

---

## 16. Microsoft Clarity

Client-side analytics via `@microsoft/clarity`. Loaded by `<ClarityProvider>` in the root
layout. No financial data is sent to Clarity — Privacy Mode users are not tracked.
The Clarity project ID is configured via `NEXT_PUBLIC_CLARITY_PROJECT_ID` (safe to expose,
it is a public analytics identifier).

---

## 17. Environment Variables

### Public (safe to expose in browser)
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase publishable key (RLS protects all data)
- `NEXT_PUBLIC_CLARITY_PROJECT_ID` — Microsoft Clarity analytics ID

### Server-only (NEVER expose client-side, NEVER `NEXT_PUBLIC_` prefix)
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS; full database compromise if leaked
- `TOTP_ENCRYPTION_KEY` — AES-256-GCM key for TOTP secrets
- `AI_PROVIDER_ENCRYPTION_KEY` — AES-256-GCM key for user AI provider keys
- `GMAIL_TOKEN_ENCRYPTION_KEY` — AES-256-GCM key for Gmail OAuth tokens
- `CHANNEL_ENCRYPTION_KEY` — AES-256-GCM key for Telegram/Slack channel credentials
- `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` — Google Cloud OAuth
- `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` — Google Sign-In (read by Supabase CLI)
- `CRON_SECRET` — Bearer token for Vercel cron authentication
- `SUPABASE_CRON_SECRET` — Bearer token for pg_cron → Vercel authentication
- `TELEGRAM_BOT_TOKEN` — BotFather token; never log, never print, never expose
- `TELEGRAM_BOT_USERNAME` — Bot username (without @)
- `TELEGRAM_WEBHOOK_SECRET` — Validates incoming Telegram webhook requests
- `RESEND_API_KEY` — Email delivery (currently disabled)
- `NOTIFICATION_FROM_EMAIL` / `NOTIFICATION_FROM_NAME` — Email sender identity
- `GEMINI_MODEL` — Optional Gemini model override

### Security rules
- Never put a secret behind `NEXT_PUBLIC_` prefix
- Never commit `.env.local` or `.env.*.local` files
- Use `pbpaste | npx vercel env add VAR_NAME production --scope spencare` to add secrets
- Never ask the user to paste secrets into chat
- Never print secret values in terminal output
- All secrets live in Vercel encrypted environment (production) and `.env.local` (local dev)
- The `apps/web/.env.example` is the only env file tracked in git — it contains placeholder
  values only, never real secrets

---

## 18. Vercel Deployment

- Production: `https://spencare.vercel.app`
- Project: `spencare` (org: `team_jtUoAnluAWbgpixV99c18iwc`, ID: `prj_FT209JrlvoguUsfRLR4k655pWFiQ`)
- Root directory: `apps/web`
- Framework: Next.js (auto-detected)
- Node: 22.x
- Build command: `next build` (from `apps/web/`)
- Cron jobs configured in `apps/web/vercel.json` (backup; pg_cron is primary scheduler)
- GitHub integration: connect via Vercel dashboard → Project Settings → Git
  After connecting, every push to `main` triggers an automatic deploy

### Deploy command (CLI, from monorepo root)
```bash
cd /path/to/spencare && npx vercel deploy --prod --yes --scope spencare --project spencare
```

### `.vercel/project.json`
Tracked in git. Contains project ref IDs (not secrets). Required for `vercel` CLI to link
this directory to the correct Vercel project without re-running `vercel link`.

---

## 19. Testing Conventions

- **Framework:** Vitest + Testing Library (`@testing-library/react`)
- **Accessibility:** jest-axe (every UI component must pass `axe()`)
- **Location:** co-located with source (`component.test.tsx` next to `component.tsx`)
- **Run:** `pnpm test` from repo root (runs all packages via Turborepo)
- **Target:** all tests must pass before any GitHub push
- **Coverage:** not enforced by CI currently, but meaningful tests are expected for all new features
- **DB tests:** pgTAP tests in `supabase/tests/`

### Test conventions
- Never mock Supabase at the module level — test components in isolation with mock props
- Use `@testing-library/user-event` for interaction tests
- Timezone-sensitive logic must have explicit tests for IST, EDT, EST, BST, SGT, AEST, AEDT
- Domain logic tests (pure functions) require no mocking

---

## 20. Git Workflow

- **Branch:** `main` (single branch, no feature branches currently)
- **Remote:** `origin → https://github.com/santhoshshanmugavel/spencare`
- **Commit style:** `feat:`, `fix:`, `docs:`, `build:`, `security:` prefixes
- **Never commit:** `.env.local`, `.vercel/.env.*`, `supabase/.temp/`, `supabase/.branches/`
- **Never commit real secrets** in any file, comment, or documentation
- **Do not run:** `git push --force` on `main`
- **Attribution footer:** every Claude-authored commit ends with:
  `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## 21. Migration Rules

1. Every schema change gets its own migration file
2. File naming: `YYYYMMDDNNNNNN_description.sql` (chronological, sequential within a day)
3. Migrations are append-only — never edit an applied migration
4. Test locally before applying to production
5. Apply via Supabase MCP `apply_migration` tool or `supabase db push`
6. Never embed real secrets in migration SQL — use `vault.decrypted_secrets` lookups at runtime
7. Include rollback comments where practical

---

## 22. Cloud Development Goal

The intended permanent architecture:

```
GitHub (permanent source of truth)
    ↓ auto-deploy on push to main
Vercel (production hosting, no laptop dependency)
    ↓ reads/writes
Supabase (production DB/auth/backend)

Claude Code (cloud development environment)
    ↓ commits to
GitHub
```

The office laptop is a temporary workstation only. Development should be fully possible from
any Claude Code cloud session with GitHub repository access and Vercel/Supabase credentials
configured in the development environment.

---

## 23. Key Decisions and Invariants

- **AI does not calculate financial truth.** The domain layer calculates; AI explains.
- **Propose, never confirm.** Spensa can only propose write actions; the user confirms in UI.
- **Service-role is server-only.** Never let service-role credentials reach client code.
- **Ownership checks are required** wherever Security Definer functions or service-role bypass RLS.
- **No platform AI key.** Users supply their own AI provider keys.
- **Transfers excluded from income/expense.** Always filter by type AND transfer_pair_id.
- **Soft-delete aware.** Always filter `deleted_at IS NULL` in user-facing queries.
- **Minor units always.** All monetary storage and arithmetic in integer minor units.
- **occurred_at vs created_at.** `occurred_at` is the financial event date (user-supplied);
  `created_at` is when the database row was inserted. Never confuse them.
- **No hardcoded secrets.** All secrets from environment; all pg_cron secrets from Supabase Vault.
- **spencare.vercel.app** is hardcoded in 8 places (instrumentation, Telegram routes, message
  composer, daily summary migration). If the domain changes, update all 8 references.
