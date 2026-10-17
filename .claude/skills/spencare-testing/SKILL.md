---
description: Apply when adding, modifying, or reviewing tests anywhere in the
  Spencare monorepo. Covers Vitest conventions, Testing Library patterns,
  jest-axe accessibility testing, pgTAP database tests, timezone requirements,
  and financial calculation test patterns.
name: spencare-testing
---

# Spencare Testing Skill

## When to invoke

Activate this skill when you:
- Add tests for a new feature or component
- Fix a bug and need regression coverage
- Modify existing test files
- Review whether a change has adequate test coverage
- Add timezone-sensitive logic
- Implement a financial calculation that needs verification

## Testing stack

| Layer | Framework |
|-------|-----------|
| Unit / integration (TS/TSX) | Vitest + `@testing-library/react` |
| Accessibility | jest-axe (`axe()` in every UI component test) |
| Interaction simulation | `@testing-library/user-event` |
| Environment | jsdom (configured in `apps/web/vitest.config.mts`) |
| Database | pgTAP (in `supabase/tests/`) |

## Run commands

```bash
# Run all tests (from monorepo root):
pnpm test

# Run web app tests only:
cd apps/web && pnpm test

# Run a specific package:
cd packages/domain/core && pnpm test

# Run with watch mode:
pnpm test -- --watch

# Run a single file:
pnpm test -- path/to/file.test.ts
```

All tests must pass before any push to main.

## File location convention

Tests are **co-located with source files**:
```
component.tsx          → component.test.tsx
lib/my-util.ts         → lib/my-util.test.ts
commands/transactions.ts → commands/transactions.test.ts
```
Do not create a separate `__tests__` directory.

## Layer-specific testing patterns

### `packages/domain/core` — pure functions
- No mocks needed. These are pure functions.
- Test with direct inputs and expected outputs.
- Every calculation function must have tests for:
  - Normal populated data
  - Empty input (no transactions)
  - Null/undefined fields
  - Zero amounts
  - Period boundaries (first/last day of month)
  - Soft-deleted transactions (ensure excluded)
  - Transfer legs (ensure excluded from income/expense)

```typescript
import { describe, it, expect } from "vitest";
import { computeSafeToSpend } from "./safeToSpend";

describe("computeSafeToSpend", () => {
  it("excludes credit account balances", () => { ... });
  it("excludes investment account balances", () => { ... });
  it("returns zero when no bank/cash accounts", () => { ... });
});
```

### `packages/domain/application` — commands and queries
- Mock repositories; never hit a real database.
- Use factory functions for test data (see existing test files for patterns).
- Test that commands call the right repository methods with the right args.
- Test query filters (deleted_at, transfer_pair_id, type) explicitly.

### `packages/domain/infra` — repositories
- Mock the Supabase client (not the full module).
- Test repository methods in isolation.
- Do not write integration tests against the production Supabase instance.

### `apps/web` — React components and server actions
- Use `@testing-library/react` with `render`.
- Every component test must include an accessibility check:
  ```typescript
  import { axe } from "jest-axe";
  it("has no accessibility violations", async () => {
    const { container } = render(<MyComponent {...props} />);
    expect(await axe(container)).toHaveNoViolations();
  });
  ```
- Mock Server Actions at the import boundary; do not mock Supabase at module level.
- Use `@testing-library/user-event` for interaction tests (clicks, typing, form submission).
- Test loading, error, success, and empty states where applicable.

### `packages/validation` — Zod schemas
- Test valid and invalid inputs for every schema.
- Test boundary values (min, max, required fields, optional fields).
- Test that error messages match expected strings.

## Timezone-sensitive logic

Any logic involving dates, period boundaries, or scheduled times must have
explicit tests for at least these timezones:
```
IST   (Asia/Kolkata,      UTC+5:30)
EDT   (America/New_York,  UTC-4)
EST   (America/New_York,  UTC-5)
BST   (Europe/London,     UTC+1)
SGT   (Asia/Singapore,    UTC+8)
AEST  (Australia/Sydney,  UTC+10)
AEDT  (Australia/Sydney,  UTC+11)
```
This ensures that date arithmetic (start of day, end of month, etc.) does not
silently break for users in non-UTC timezones.

## Financial calculation tests

For any monetary calculation, verify:
1. Amounts use `Money` from `@spencare/domain-core` — not raw numbers.
2. Minor-unit conversions are correct (e.g. ₹500.00 = `50000`).
3. Summation does not use floating-point (no `array.reduce((a, b) => a + b.amount, 0)`).
4. Large amounts (e.g. ₹10,00,000.00) do not overflow.
5. Negative balances (credit card debt) are handled correctly.

## Accessibility test setup

The `vitest.setup.ts` in `apps/web` configures jest-axe matchers globally.
Every new React component in `apps/web/` must have an axe test. This is a
**project requirement**, not optional polish.

## pgTAP database tests

For database migrations that change RLS policies, constraints, or triggers:
- Add a pgTAP test in `supabase/tests/`.
- Run with: `supabase test db` (local stack must be running).
- Test that RLS policies correctly scope data to the authenticated user.
- Test that service-role access works as expected for cross-user operations.

## What not to test

- Do not write tests that only repeat the implementation detail without testing behavior.
- Do not test framework code (Next.js routing, Supabase client internals).
- Do not mock Supabase at the module level in component tests; inject mock props instead.
- Do not test styling (CSS class names are not behavior).

## Reporting

After implementing tests, briefly state:
1. Which test files were added or modified.
2. What scenarios are covered (normal case, edge cases, error states).
3. Actual test run result (`pnpm test` output).
4. Any tests that could not be written and why.
