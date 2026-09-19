-- ============================================================
-- Notification fixes (Phase 32)
-- ============================================================
-- 1. Add 'commitment' and 'loan' to notification_category enum.
--    The TypeScript type already declares these; the DB was missing them,
--    causing every commitment/loan notification insert to throw an enum
--    violation and silently kill all notifications for that user.
--
-- 2. Backfill telegram notification_preferences for any user who has
--    an active channel_connection for telegram but no preference row.
--    Without this row, isChannelEnabled() returns false and Telegram
--    messages are never delivered even for connected users.
-- ============================================================

-- 1. Extend the enum

alter type notification_category add value if not exists 'commitment';
alter type notification_category add value if not exists 'loan';

-- 2. Backfill telegram preferences for existing connected users

insert into notification_preferences (user_id, channel, event_type, enabled)
select
  cc.user_id,
  'telegram'::notification_channel,
  null::text,      -- global channel preference (not event-specific)
  true
from channel_connections cc
where cc.channel = 'telegram'
  and cc.status = 'connected'
  and not exists (
    select 1
    from notification_preferences np
    where np.user_id = cc.user_id
      and np.channel = 'telegram'
      and np.event_type is null
  )
on conflict (user_id, channel, coalesce(event_type, '')) do nothing;
