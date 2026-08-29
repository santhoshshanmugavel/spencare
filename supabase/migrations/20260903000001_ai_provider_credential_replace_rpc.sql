-- Spencare — BYO AI provider credential atomic replace RPC (Phase 17).
--
-- `ai_provider_credentials` has existed since Foundation with a unique
-- index enforcing exactly one active row per user
-- (ai_provider_credentials_one_active_per_user), but no command has ever
-- written to it outside Phase 16's dev-only `seedProviderCredential` seed
-- path. Phase 17 is the first real connect/switch/rotate flow.
--
-- LOCKED DECISION #2 (rotation): validate the NEW key against the real
-- provider BEFORE ever touching the database. An invalid new key must
-- never destroy a valid existing credential. This RPC is only ever called
-- AFTER that validation has already succeeded -- it does the DB write
-- half of connect/switch/rotate, and does it atomically: DELETE any
-- existing row for this user, then INSERT the new one, both inside the
-- one transaction this PL/pgSQL function body runs in. If the INSERT
-- fails for any reason (a constraint violation, an unexpected null, etc.),
-- the DELETE rolls back with it -- the existing working credential can
-- never be left in a "deleted, but the replacement never landed" state.
--
-- LOCKED DECISION #3 (disconnect): this RPC is NOT used for
-- disconnectProvider -- that's a plain DELETE via the caller's own
-- RLS-scoped client (see disconnectCredential in
-- aiProviderCredentialsRepo.ts), since it needs no atomicity with an
-- insert and doesn't touch encrypted_api_key.
--
-- SECURITY: this function does NOT check `p_user_id = auth.uid()` the way
-- `confirm_command` does, because it is never meant to be callable by an
-- authenticated end-user's own client at all -- only by the service-role
-- client, from application code that has already resolved AuthContext
-- server-side and already validated the new key. EXECUTE is explicitly
-- revoked from `authenticated`/`anon` below for exactly this reason: if a
-- regular authenticated user could call this RPC directly via PostgREST,
-- they could pass an arbitrary p_user_id and overwrite or delete another
-- user's credential, or bypass the validate-before-write ordering
-- entirely. Matches the same service-role-only trust model already
-- established for `getActiveEncryptedCredential`/`seedProviderCredential`.

create function replace_active_ai_provider_credential(
  p_user_id uuid,
  p_provider ai_provider,
  p_encrypted_api_key bytea,
  p_key_last_four text
) returns ai_provider_credentials
language plpgsql security definer as $$
declare
  v_row ai_provider_credentials;
begin
  delete from ai_provider_credentials where user_id = p_user_id;

  insert into ai_provider_credentials (user_id, provider, encrypted_api_key, key_last_four, is_active, last_validated_at, last_validation_error)
    values (p_user_id, p_provider, p_encrypted_api_key, p_key_last_four, true, now(), null)
    returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function replace_active_ai_provider_credential from public, anon, authenticated;
grant execute on function replace_active_ai_provider_credential to service_role;
