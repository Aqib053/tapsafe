-- Overdue reminder. Run once in the Supabase SQL editor on the live project.
-- supabase/schema.sql is the baseline and already has the driver column below,
-- so a fresh project only needs the cron part (steps 2 and 3).

-- 1. Where the driver's overdue alert goes.
alter table public.drivers
  add column if not exists telegram_chat_id bigint;

-- 2. Extensions for the schedule.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- 3. Store a shared secret in Vault. Do this by hand, not in this file:
--
--      select vault.create_secret('<long random string>', 'cron_secret');
--
--    Use the SAME string as the CRON_SECRET secret of the check_overdue
--    Edge Function. Never commit it.

-- 4. Every 5 minutes, call the Edge Function.
select cron.schedule(
  'check_overdue',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://wezlcctfzbfdturzlvrq.supabase.co/functions/v1/check_overdue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
