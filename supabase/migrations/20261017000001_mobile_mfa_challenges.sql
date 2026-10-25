-- Description: mobile_mfa_challenges — short-lived, single-use MFA challenge tokens
-- for React Native mobile clients.
--
-- Background: The web app gates post-login MFA via an httpOnly spencare_mfa_pending
-- cookie enforced in middleware. Mobile clients cannot reliably use httpOnly cookies,
-- so the mobile auth API issues an opaque challenge_token instead of the Supabase
-- session after a successful credential check when two_factor_enabled = true. The
-- client redeems the challenge_token (plus TOTP/backup code) at /api/mobile/auth/verify-2fa,
-- which atomically consumes the challenge and returns the Supabase session.
--
-- Security properties:
--   - Only a SHA-256 hex hash of the raw token is stored; the raw token never persists.
--   - The Supabase session (access_token + refresh_token) obtained during sign-in is
--     encrypted with AES-256-GCM (CHANNEL_ENCRYPTION_KEY) and stored alongside the hash;
--     it is decrypted and returned only after successful MFA verification.
--   - Expiry: 10 minutes (enforced at query time; checked before the TOTP clock window).
--   - Single-use consumption: the verify-2fa route uses an optimistic UPDATE WHERE
--     consumed_at IS NULL; if two concurrent requests win the TOTP check, only one
--     UPDATE succeeds (PostgreSQL row-level lock). The loser gets 401.
--   - RLS enabled with no policies: regular anon/user connections see no rows.
--     All access is via the service-role client in server-side route handlers.
--   - No pg_cron cleanup yet; expired rows accumulate until a future maintenance task.
--
-- Rollback: DROP TABLE IF EXISTS mobile_mfa_challenges;

CREATE TABLE IF NOT EXISTS mobile_mfa_challenges (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash       TEXT        NOT NULL UNIQUE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_session TEXT       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_at      TIMESTAMPTZ,
  CONSTRAINT mobile_mfa_challenges_expiry_after_creation
    CHECK (expires_at > created_at)
);

-- Primary lookup: find a challenge by its token hash
CREATE INDEX IF NOT EXISTS idx_mobile_mfa_challenges_token_hash
  ON mobile_mfa_challenges (token_hash);

-- Expiry index: filters in WHERE clauses and future cleanup
CREATE INDEX IF NOT EXISTS idx_mobile_mfa_challenges_expires_at
  ON mobile_mfa_challenges (expires_at);

-- RLS: enabled with zero policies = anon/user role cannot read or write any row.
-- Service-role client (used in route handlers) bypasses RLS per Supabase design.
ALTER TABLE mobile_mfa_challenges ENABLE ROW LEVEL SECURITY;
