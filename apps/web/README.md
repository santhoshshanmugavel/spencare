# Spencare

Personal finance management application. Track spending, manage accounts, plan budgets,
progress toward savings goals, manage recurring bills, and get AI-powered insights via Spensa.

Production: **https://spencare.vercel.app**

---

## Architecture

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS 4 + Sera design system (shadcn primitives)
- **Database:** Supabase (PostgreSQL 17, RLS, pg_cron, pg_net)
- **Auth:** Supabase Auth (email/password, Google OAuth, TOTP 2FA)
- **AI:** User-supplied API keys (Gemini, OpenAI, Anthropic) — no platform-wide AI key
- **Notifications:** In-app + Telegram (email integrated, currently disabled)
- **Build system:** Turborepo 2 + pnpm 10 workspaces
- **Hosting:** Vercel

This app lives inside a monorepo. See the [root CLAUDE.md](../../CLAUDE.md) for complete
architectural documentation.

---

## Repository Structure

```
spencare/                       ← monorepo root
├── apps/
│   ├── web/                    ← this app (Vercel)
│   └── mcp-server/             ← stdio MCP server
├── packages/
│   ├── ai/                     ← AI provider adapters
│   ├── validation/             ← Zod schemas
│   └── domain/
│       ├── core/               ← value objects, pure logic
│       ├── application/        ← commands, queries, notification composers
│       └── infra/              ← Supabase repository implementations
├── supabase/migrations/        ← all schema migrations
└── docs/                       ← phase reports
```

---

## Development Setup

### Prerequisites
- Node.js ≥20 (recommended: 22.x)
- pnpm 10.20.0
- Supabase CLI (for local database)

### Install dependencies
```bash
pnpm install
```

### Local environment
Copy the environment template and fill in your local Supabase values:
```bash
cp apps/web/.env.example apps/web/.env.local
```

Start local Supabase (Docker required):
```bash
npx supabase start
```

Start the development server:
```bash
pnpm dev
```

The app runs at http://localhost:3000.

---

## Commands

All commands run from the **monorepo root** (`/spencare/`, not `/spencare/apps/web/`).

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers |
| `pnpm build` | Build all packages and the web app |
| `pnpm test` | Run all test suites |
| `pnpm typecheck` | TypeScript type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm conformance` | Verify package boundary rules |

---

## Environment Variables

Copy `apps/web/.env.example` to `apps/web/.env.local` for local development. The example
file documents every variable with its purpose and security classification.

**Never commit `.env.local` or any file containing real secrets.**

### Variable categories

**Public (safe in browser bundle):**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`

**Server-only (never `NEXT_PUBLIC_`):**
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS; treat as a database root password
- Encryption keys: `TOTP_ENCRYPTION_KEY`, `AI_PROVIDER_ENCRYPTION_KEY`,
  `GMAIL_TOKEN_ENCRYPTION_KEY`, `CHANNEL_ENCRYPTION_KEY`
- OAuth: `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`
- Scheduler: `CRON_SECRET`, `SUPABASE_CRON_SECRET`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
- Email: `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `NOTIFICATION_FROM_NAME`

Production secrets are stored in Vercel encrypted environment — never in this repository.

---

## Database

Schema is managed via migrations in `supabase/migrations/`. Never edit an applied migration —
always create a new file. Apply migrations locally with `supabase db push`.

---

## Testing

```bash
pnpm test
```

Tests are co-located with source files (e.g. `button.test.tsx` next to `button.tsx`).
All tests use Vitest + Testing Library. Accessibility is verified with jest-axe.

---

## Deployment

### Production (Vercel)
After connecting the GitHub repository to Vercel, every push to `main` triggers an
automatic production deploy.

Manual CLI deploy (from monorepo root):
```bash
npx vercel deploy --prod --yes --scope spencare --project spencare
```

Vercel project settings:
- Root directory: `apps/web`
- Node version: 22.x
- Framework: Next.js (auto-detected)

### Database (Supabase)
- Production project: `wjaxxoselhlbjrtuhqlq` (ap-southeast-2)
- Apply migrations via `supabase db push` or the Supabase MCP tool

---

## Security

- All user financial data is protected by Row Level Security (RLS) at the database level
- The Supabase anon key is safe to expose — RLS ensures users can only access their own data
- The service-role key bypasses RLS — it is server-only and never bundled client-side
- All sensitive credentials (OAuth tokens, encryption keys, AI provider keys) are encrypted at rest
- No platform-wide AI API key exists — users supply their own
- See `apps/web/.env.example` for the complete security classification of every variable
