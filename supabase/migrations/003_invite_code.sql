-- Parent invite codes. Run once in the Supabase SQL editor on the live project.
-- supabase/schema.sql already has this column, so a fresh project skips this.
--
-- Each parent gets a random code. The invite link is
--   https://t.me/<bot_username>?start=<invite_code>
-- When the parent presses Start, the telegram_webhook function saves their
-- Telegram chat id on the matching row.

alter table public.parents
  add column if not exists invite_code text not null
    default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

alter table public.parents
  add constraint parents_invite_code_key unique (invite_code);
