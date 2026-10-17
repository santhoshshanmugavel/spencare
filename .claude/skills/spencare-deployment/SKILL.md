---
description: Apply before deploying to production, verifying a deployment,
  adding or changing environment variables, or assessing whether a change is
  production-ready. Covers the Vercel deploy workflow, pre-deploy checklist,
  env var management, and post-deploy verification for Spencare.
name: spencare-deployment
---

# Spencare Deployment Skill

## When to invoke

Activate this skill when you:
- Are about to deploy to production (Vercel)
- Add or change environment variables
- Make schema migrations that must be applied before deploying
- Need to verify a deployment succeeded
- Assess production-readiness of a change
- Troubleshoot a failed deployment

## Production environment

| Item | Value |
|------|-------|
| URL | `https://spencare.vercel.app` |
| Platform | Vercel |
| Project | `spencare` |
| Org | `team_jtUoAnluAWbgpixV99c18iwc` |
| Project ID | `prj_FT209JrlvoguUsfRLR4k655pWFiQ` |
| Root dir | `apps/web` |
| Node | 22.x |
| Framework | Next.js (auto-detected) |

## Pre-deploy checklist

Run these checks from the repo root **before** deploying. Do not skip.

```bash
# 1. Type check all packages
pnpm -r typecheck

# 2. Lint web app
cd apps/web && pnpm lint

# 3. Run all tests
pnpm test

# 4. Build web app locally (catches build errors before deploy)
cd apps/web && pnpm build
```

All four must pass. If any fails, fix the issue before deploying.

## Database migrations

If this change includes a new migration:
1. Confirm the migration has been tested locally: `supabase db push` (local) first.
2. Apply to production via Supabase MCP `apply_migration` tool or:
   ```bash
   supabase db push --linked
   ```
3. Apply migrations **before** deploying the application code that depends on them.
4. Verify the migration applied cleanly in the Supabase dashboard or via:
   ```bash
   supabase migration list
   ```

## Environment variables

### Adding a new variable

```bash
# Never paste secrets directly in the terminal history.
# Copy the secret to clipboard, then:
pbpaste | npx vercel env add VAR_NAME production --scope spencare

# For non-secret values:
echo "value" | npx vercel env add VAR_NAME production --scope spencare
```

### Update .env.example

After adding a real env var, add a placeholder entry to `apps/web/.env.example`:
```bash
NEW_VAR_NAME=your-value-here
```
Do NOT put the real value in `.env.example` — it is tracked in git.

### Verify env vars are available
After adding via CLI, confirm in Vercel dashboard:
- Project → Settings → Environment Variables
- Check the variable appears for the correct environment (Production/Preview/Development)

## Deploy command

From the monorepo root:
```bash
cd /Users/santhoshs/Desktop/spencare && npx vercel deploy --prod --yes --scope spencare --project spencare
```

The `--yes` flag skips interactive confirmation. Do not use `--force` unless
explicitly directed.

## Post-deploy verification

After deployment:
1. **Check deploy status:**
   ```bash
   npx vercel ls --scope spencare --project spencare
   ```
2. **Open the production URL:** `https://spencare.vercel.app`
3. **Verify the changed feature works** — navigate to the affected route and
   confirm the behavior is correct.
4. **Check for runtime errors** in the Vercel dashboard (Functions → Logs)
   or via Vercel MCP `get_runtime_errors` and `get_runtime_logs`.
5. **Check cron jobs** are running if the change affects scheduled tasks
   (Vercel dashboard → Deployments → Cron Jobs).

Never claim a deployment succeeded without checking the actual Vercel status.

## Rollback

If a production deployment causes a regression:
1. Identify the last working deployment in Vercel dashboard.
2. Use Vercel dashboard → Deployments → Promote to roll back.
3. Or via CLI: `npx vercel rollback --scope spencare`
4. If a migration was applied and needs reverting, create a new migration
   that reverts the schema change (never edit the applied migration).

## GitHub auto-deploy

The GitHub integration auto-deploys on push to `main`:
- GitHub: `santhoshshanmugavel/spencare`
- Configure in Vercel dashboard → Project Settings → Git

When auto-deploy is active, every commit to `main` triggers a production deploy.
Run the pre-deploy checklist before pushing to main.

## Build failure diagnosis

If the build fails on Vercel:
1. Check build logs in Vercel dashboard → Deployment → Build Logs.
2. Reproduce locally: `cd apps/web && pnpm build`.
3. Common causes: TypeScript errors, missing env vars, failed imports.
4. Fix the cause, then redeploy. Do not override type errors with `@ts-ignore`
   unless there is a documented reason.

## Secrets reminder

Never:
- Log env var values in build scripts
- Print NEXT_PUBLIC_ secrets that aren't meant to be public
- Include real credentials in `apps/web/.env.example`
- Store secrets in git history (check with `git log -S "secret-value"`)
