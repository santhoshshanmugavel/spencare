-- Spencare database schema, Phase 27: MCP OAuth 2.1 authorization server.
--
-- WHY THIS EXISTS: `/api/mcp` (Phase 22) already authenticates every
-- request against a real `mcp_sessions` bearer token -- but the ONLY way
-- to obtain one, until now, was a signed-in user manually clicking
-- "Generate token" in Settings -> MCP and pasting it into a client's
-- config. That is fine for Claude Desktop's stdio launch model (one
-- config file, one user, one machine) but is NOT what a customer-facing
-- Claude/ChatGPT "remote MCP connector" needs: those clients expect an
-- OAuth authorization-code flow they can drive themselves (redirect the
-- user to log in, get consent, come back with a token), never a
-- copy-pasted secret.
--
-- ARCHITECTURE DECISION (reuse, not a parallel token system): the OAuth
-- token endpoint mints its access token by calling the EXISTING
-- `createMcpSession` command -- the exact same function the manual
-- "Generate token" button already calls. `/api/mcp` therefore needs ZERO
-- changes: it has never cared HOW a bearer token was minted, only that it
-- hashes to a live, non-revoked `mcp_sessions` row. These two new tables
-- are the minimum OAuth-protocol bookkeeping that manual generation never
-- needed: WHO is allowed to ask for a token (`oauth_clients`, via
-- lightweight dynamic registration, RFC 7591) and the short-lived,
-- single-use proof that a real user actually logged in and consented
-- (`oauth_authorization_codes`) before the token endpoint is allowed to
-- mint anything.
--
-- Both tables are service-role-only (no `authenticated`-role policy at
-- all) -- the same posture already used for `mcp_sessions.token_hash`'s
-- own access path: the authorize/token Route Handlers read/write these
-- via the service-role client after resolving the real user from their
-- own already-verified Supabase session, never from anything the OAuth
-- client supplies.

create table oauth_clients (
  id uuid primary key default gen_random_uuid(),
  -- Public identifier only -- these are PUBLIC clients (PKCE is the
  -- actual proof-of-possession, per OAuth 2.1's own recommendation for
  -- exactly this "unknown dynamic client, no way to keep a secret"
  -- shape: a remote AI connector has no secure place to store a client
  -- secret any more than a mobile app does). No client_secret column
  -- exists here by design, not by omission.
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  -- Hashed at rest, same discipline as mcp_sessions.token_hash -- the
  -- plaintext code exists only in the redirect URL and the client's own
  -- token-exchange request, never persisted.
  code_hash text not null unique,
  client_id text not null references oauth_clients(client_id),
  user_id uuid not null references auth.users(id),
  redirect_uri text not null,
  scopes text[] not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Single-use: set the moment the token endpoint successfully exchanges
  -- it. A second exchange attempt against an already-consumed code (or
  -- one whose owning session has since been revoked) must be rejected --
  -- OAuth 2.1 requires the entire token lineage be revoked if a
  -- consumed/expired code is presented again, since that is a strong
  -- signal of code interception; this column is what makes that
  -- detectable.
  consumed_at timestamptz
);
create index oauth_authorization_codes_client_id_idx on oauth_authorization_codes (client_id);

alter table oauth_clients enable row level security;
alter table oauth_authorization_codes enable row level security;
-- Deliberately no policies for `authenticated` on either table -- every
-- access goes through the service-role client from apps/web's own
-- /oauth/* Route Handlers, after that Route Handler has independently
-- verified the real signed-in user via `createServerSupabaseClient()`.
