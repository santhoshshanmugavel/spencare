---
description: Apply when implementing or reviewing authentication flows, API
  routes, server actions, database operations, credential handling, or any
  code that touches user data, financial information, or system secrets.
  Enforces Spencare's security and privacy requirements.
name: spencare-security
---

# Spencare Security Skill

## When to invoke

Activate this skill when you:
- Add or modify authentication or authorization logic
- Write a new API route handler or server action
- Add a new Supabase repository or database operation
- Handle user-supplied input that reaches the database or external services
- Add or change environment variables
- Implement any feature that accesses another user's data (service-role operations)
- Handle credentials, tokens, encryption keys, or API keys
- Add webhook endpoints or external callbacks
- Review a PR or change for security implications

## Authentication and session management

Spencare uses Supabase Auth via `@supabase/ssr`:
- Session cookies are managed by the Next.js middleware (`apps/web/lib/supabase/middleware.ts`).
- Server-side client: `createServerClient` — reads from the request/response cookies.
- Client-side: `createBrowserClient` — accesses the same Supabase project.
- All auth state is derived from the Supabase session; never store userId in localStorage manually.
- 2FA: TOTP secrets are encrypted with `TOTP_ENCRYPTION_KEY` (AES-256-GCM) in the DB.

**Check before writing any server action or route handler:**
```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { error: "Unauthorized" };
```

## RLS enforcement

- Every user-owned table has RLS enabled.
- Policies use `auth.uid()` to scope rows to the authenticated user.
- Never bypass RLS on the client-side Supabase client.
- The service-role client (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS — see below.

### Service-role operations
The service-role client is used ONLY for:
- Cron jobs (`/api/cron/*`)
- Gmail sync
- Notification delivery
- MCP OAuth flows
- Admin operations that legitimately need cross-user access

**Whenever you use the service-role client, you MUST add an explicit ownership check:**
```typescript
// Always scope service-role queries to the specific user
.eq("user_id", userId)
```
Without this, a bug could expose one user's data to another.

## Secrets and environment variables

### Rules
1. Never put a secret behind `NEXT_PUBLIC_` prefix — it will be bundled client-side.
2. Never commit `.env.local` or `.env.*.local` files.
3. Never print secret values in terminal output, logs, or error messages.
4. Never ask the user to paste secrets into chat.
5. To add a new secret to Vercel production:
   ```bash
   pbpaste | npx vercel env add VAR_NAME production --scope spencare
   ```
6. New env vars must be documented in `apps/web/.env.example` with placeholder values.

### Server-only secrets (must NEVER have NEXT_PUBLIC_ prefix)
```
SUPABASE_SERVICE_ROLE_KEY
TOTP_ENCRYPTION_KEY
AI_PROVIDER_ENCRYPTION_KEY
GMAIL_TOKEN_ENCRYPTION_KEY
CHANNEL_ENCRYPTION_KEY
GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET
CRON_SECRET
SUPABASE_CRON_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
RESEND_API_KEY
```

## Input validation

All untrusted input (user form submissions, API request bodies, query params)
must be validated with Zod schemas from `@spencare/validation`:
```typescript
import { TransactionSchema } from "@spencare/validation";
const parsed = TransactionSchema.safeParse(body);
if (!parsed.success) return { error: parsed.error.flatten() };
```

For new input shapes, add a Zod schema to `packages/validation/src/` with tests.
Never trust `req.body` or form data without parsing and validating first.

## Server actions security checklist

Every server action must:
- [ ] Authenticate the user (`supabase.auth.getUser()`)
- [ ] Validate all inputs (Zod schema from `@spencare/validation`)
- [ ] Use the authenticated user's ID — never accept `userId` as a user input
- [ ] Return structured errors, not stack traces or internal details
- [ ] Never log sensitive field values (passwords, keys, tokens, PINs)

## API route security

For `/api/*` route handlers:
- Cron routes (`/api/cron/*`) authenticate with `CRON_SECRET` or `SUPABASE_CRON_SECRET`
  Bearer token — check `Authorization: Bearer` header.
- MCP routes use per-session Bearer tokens from `mcp_sessions` table.
- Telegram webhook validates with `TELEGRAM_WEBHOOK_SECRET` in X-Telegram-Bot-Api-Secret-Token.
- No route should return internal error messages, stack traces, or DB errors to the client.

## IDOR (Insecure Direct Object Reference) prevention

When fetching a resource by ID, always verify the requesting user owns it:
```typescript
// BAD — does not verify ownership:
const { data } = await supabase.from("goals").select("*").eq("id", goalId);

// GOOD — RLS handles this automatically on the user-scoped client:
const { data } = await supabase.from("goals").select("*").eq("id", goalId);
// (The user-scoped Supabase client applies RLS automatically)

// Service-role requires explicit ownership check:
const { data } = await adminSupabase.from("goals").select("*")
  .eq("id", goalId).eq("user_id", userId);
```

## Encryption for sensitive data

User-supplied credentials are encrypted at rest:
- AI provider keys → `AI_PROVIDER_ENCRYPTION_KEY` (AES-256-GCM)
- Gmail OAuth tokens → `GMAIL_TOKEN_ENCRYPTION_KEY` (AES-256-GCM)
- TOTP secrets → `TOTP_ENCRYPTION_KEY` (AES-256-GCM)
- Telegram/channel credentials → `CHANNEL_ENCRYPTION_KEY` (AES-256-GCM)

Encryption/decryption helpers are in `packages/domain/infra/src/crypto.ts`.
Never implement custom encryption — use the existing helpers.

## Common vulnerability checklist

Before completing any security-relevant change:
- [ ] No sensitive data in `NEXT_PUBLIC_` variables
- [ ] All untrusted inputs validated with Zod
- [ ] Service-role operations have explicit user ownership checks
- [ ] Error responses do not include stack traces or internal details
- [ ] No credentials, tokens, or secrets in logs, comments, or error messages
- [ ] New webhook endpoints validate their authentication token
- [ ] Redirect targets are validated (no open redirect)
- [ ] File upload paths are validated (no directory traversal)
- [ ] Rate limiting is considered for public-facing endpoints

## Security-relevant files

| Purpose | Location |
|---------|----------|
| Middleware (session) | `apps/web/lib/supabase/middleware.ts` |
| Crypto helpers | `packages/domain/infra/src/crypto.ts` |
| Rate limiting | `packages/domain/application/src/commands/rateLimit.ts` |
| Security headers | `apps/web/lib/security-headers.ts` |
| 2FA logic | `packages/domain/core/src/twoFactor.ts` |
| MCP auth | `apps/mcp-server/src/auth.ts` |
| Pending confirmations | `packages/domain/infra/src/pendingConfirmationsRepo.ts` |

## Reporting security findings

Rate each finding by severity:
- **Critical** — data from one user exposed to another; auth bypass; secret leaked
- **High** — missing auth check; unvalidated input reaching DB; unprotected route
- **Medium** — missing ownership check; sensitive data in logs; weak validation
- **Low** — defense-in-depth improvement; best practice divergence

Include: file path, line number, evidence, and recommended fix.
