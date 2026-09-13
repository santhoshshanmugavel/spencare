-- Fix: telegram_link_tokens was missing INSERT and UPDATE policies.
-- The authenticated user must be able to insert their own tokens and
-- update (invalidate) their own unused tokens via the anon client in
-- the connect route. Service role bypasses RLS for the webhook resolve.

create policy "Users can insert their own Telegram link tokens"
  on telegram_link_tokens for insert
  with check (user_id = auth.uid());

create policy "Users can update their own Telegram link tokens"
  on telegram_link_tokens for update
  using (user_id = auth.uid());
