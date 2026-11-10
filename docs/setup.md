# Setup

Order matters. Test on yourself first, then add the van.

## 1. Try the app with no backend

Open the site with `?demo` on the end, for example `http://localhost:8000/?demo`. Any phone and PIN work. Nothing is saved.

Serve the app locally with `python3 -m http.server 8000 --directory web`.

## 2. Supabase

1. Create a free project.
2. Run `supabase/schema.sql` in the SQL editor.
3. In **Authentication > Users**, add a driver login:
   - Email: the 10-digit phone number, then `@tapsafe.local`. Example: `9999999999@tapsafe.local`. No country code.
   - Password: the driver's PIN. Supabase may require 6 or more characters, so use a 6-digit PIN.
   - Turn on "Auto confirm user".
4. In the table editor, add rows. Use your own details for the first test.
   - `drivers`: name, phone, van_number, and `auth_user_id` set to the user id from step 3.
   - `parents`: name, phone, and `telegram_chat_id`.
   - `children`: name, `parent_id`, `driver_id`, stop, `drop_order`.
5. Copy the project URL and the **anon** key into `web/js/config.js`. Never copy the service role key anywhere in this repo.

## 3. Telegram (test on yourself)

1. In Telegram, message @BotFather, send `/newbot`, and follow the prompts. Save the token in Supabase secrets, not in the repo.
2. Open your new bot and press Start.
3. Get your chat id: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and read `message.chat.id`. Do this in a private window and do not share the URL.
4. Put that id in your own `parents` row. You are the parent for the first test.

## 4. Deploy the mark_event function

1. In Supabase, open **Edge Functions > Deploy a new function > Via Editor**.
2. Name it `mark_event`. Paste the code from `supabase/functions/mark_event/index.ts`. Deploy.
3. Open the function's settings and turn **off** "Verify JWT with legacy secret". The function checks the signed-in driver itself.
4. Open **Edge Functions > Secrets** and add `TELEGRAM_BOT_TOKEN` with your bot token. Supabase fills in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` itself.

Without the token the taps still save. Only the Telegram message is skipped.

## 5. Overdue reminder (check_overdue)

If a child is on board 60 minutes after the trip started, the parent and the driver get a message. Each child is reminded once.

1. **Edge Functions > Deploy a new function > Via Editor.** Name it `check_overdue`, paste `supabase/functions/check_overdue/index.ts`, deploy. Turn **off** "Verify JWT with legacy secret". The function checks a secret header instead.
2. Make a long random string. Add it as the Edge Function secret `CRON_SECRET`.
3. In the SQL editor, store the same string in Vault. Do not put it in any file:
   `select vault.create_secret('<the same string>', 'cron_secret');`
4. Run `supabase/migrations/002_overdue.sql`. It adds `drivers.telegram_chat_id` and schedules the check every 5 minutes.
5. Put the driver's Telegram chat id in `drivers.telegram_chat_id`. Without it, only the parent is messaged.

To test quickly, add the secret `OVERDUE_MINUTES` with value `2`, start a trip, tap Boarded, and wait up to 5 minutes. Delete that secret afterwards so the real limit is 60.

## 6. Parent invite links

Parents connect Telegram with one tap. No ids are copied by hand.

1. Run `supabase/migrations/003_invite_code.sql`. Every parent row gets an `invite_code`.
2. Deploy the function `telegram_webhook` (Edge Functions > Via Editor). Turn **off** "Verify JWT with legacy secret", because Telegram does not send one.
3. Make a random string of letters and digits, at least 16 characters. Save it as the Edge Function secret `TELEGRAM_WEBHOOK_SECRET`.
4. In the terminal run `node scripts/set-webhook.mjs`. Type the bot token and that same string when asked. Nothing is stored.
5. For each parent, send them this link. Use your bot's username and the parent's `invite_code` from the table:
   `https://t.me/<bot_username>?start=<invite_code>`
6. The parent taps it and presses Start. Their `telegram_chat_id` fills in and the bot replies with their children's names.

A link works for one Telegram account. If someone else opens an already used link, the bot refuses. To move a parent to a new account, clear their `telegram_chat_id` in the table and send the link again.

To test, add a new parent row with no `telegram_chat_id`, open its link from a second Telegram account, and watch the row fill in.

## 7. Deploy the app

1. Push the repo to GitHub.
2. In Vercel, import the repo. Set **Root Directory** to `web`. Framework preset: **Other**. No build command.
3. Open the Vercel URL on the Android phone and use **Add to Home screen**.
