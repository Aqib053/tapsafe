# TapSafe: context for Claude Code

## What this is

TapSafe sends a parent a Telegram message when their child boards a private school van and again when the child reaches home. The driver taps once per child. Pilot: one van in Bangalore, run by me with my cousin's driver and 2 to 3 parents. No school is involved.

## Current state

- The driver app works against a live Supabase project. A trip was tested end to end with real Telegram messages.
- The app lives in `web/`. It is static (no build step) and installable as a PWA. Demo mode (`?demo`, or empty `config.js`) runs with no backend.
- Supabase holds the schema, three Edge Functions and the overdue schedule. See "Backend" below.
- Not done yet: Vercel deploy, the real-van test, and running the wrong-child test script.
- The repo is public.

## Decisions

- Name: TapSafe.
- Scope: afternoon trip only, school pickup to home drop.
- Out of scope for now: morning pickup, school dashboard, live map, SMS, WhatsApp API, drop-off OTP, crash detection, iOS.
- Alerts go to the parent and the driver only.
- I act as admin and enter children, parents and the driver through the Supabase table editor.
- Driver logs in with phone number and PIN.
- The driver taps a child's name. QR cards come later.
- Free tiers only: web app (PWA) on Vercel, Supabase for database, login, Edge Functions and pg_cron, Telegram bot made with @BotFather.

## Data model

- `drivers`: name, phone, van_number, auth_user_id, telegram_chat_id
- `parents`: name, phone, telegram_chat_id, invite_code
- `children`: name, parent_id, driver_id, stop, drop_order
- `trips`: driver_id, start_time, end_time, status (`active` or `completed`)
- `events`: trip_id, child_id, type (`boarded`, `dropped` or `absent`), time, overdue_notified_at

Trips are created by the app each day. Events are written only by the `mark_event` Edge Function. The other tables change rarely.

The driver's login is a Supabase Auth user with email `<10-digit phone>@tapsafe.local` and the PIN as password. `drivers.auth_user_id` links the two.

## Backend

- `supabase/schema.sql`: baseline schema with Row Level Security. `supabase/migrations/` holds changes for a project that already ran the baseline.
- `supabase/functions/mark_event`: saves a tap and messages the parent. Checks the caller is the driver and the child is on their list.
- `supabase/functions/check_overdue`: runs every 5 minutes from pg_cron. Needs the `CRON_SECRET` secret and a matching `cron_secret` in Vault.
- `supabase/functions/telegram_webhook`: saves a parent's chat id when they press Start from their invite link. Needs `TELEGRAM_WEBHOOK_SECRET`.
- Edge Functions are deployed by pasting code in the dashboard. Turn off "Verify JWT with legacy secret" on each one.
- Secrets live only in Supabase: `TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, and `OVERDUE_MINUTES` (testing only, default 60).
- `scripts/` holds Node scripts for testing and setup. They ask for secrets at a prompt and never store them.
- `docs/setup.md` has the setup steps.

## Rules the app must follow

Status in brackets.

1. **Start Trip** creates a trip. Each tap creates an event and sends a Telegram message to the parent. [Done]
2. **End Trip** is blocked while any child is still `boarded` or has no status yet. [Done, enforced by a database trigger]
3. **Overdue check:** if a child is `boarded` and not `dropped` 60 minutes after the trip started, message the parent and the driver. Run it with pg_cron every 5 to 10 minutes. Remind each child once. [Done and tested]
4. **Wrong child:** if a scanned child is not on this van's list, the phone beeps and shows "Not on your list", and that child's parent is alerted. [Enforced in `mark_event`. The app only lists the driver's own children, so it cannot happen from the UI until QR cards exist. Script test not run yet.]
5. **Offline:** taps are saved on the phone and sent when the network returns. [Done]

## Message text

- `Rahul boarded KA-01-XX-1234`
- `Rahul reached home`
- `Rahul was marked absent today`
- `Rahul has not been dropped yet. Please call the driver.` (to the parent)
- `Rahul has not been dropped yet.` (to the driver)

## Constraints

- Never commit the Telegram bot token, the Supabase service role key or any real child or parent data. Keep them in Supabase and Vercel settings.
- Turn on Row Level Security for every table. The public anon key must not expose parent phone numbers or Telegram chat IDs.
- Use the service role key only inside Edge Functions.
- The driver's phone is Android on mobile data. Keep the driver screen to one tap per child.

## Working rules

- Small commits. One change per commit, one topic per pull request. Never push straight to `main`.
- Keep files in folders: app in `web/` (`js/`, `css/`, `icons/`), landing page in `site/`, database in `supabase/`, scripts in `scripts/`, notes in `docs/`. No loose files in the repo root except README.md and CLAUDE.md.

## Writing style

Keep UI text and messages short and plain. No filler openers, no slogans.

## Next steps

1. Deploy `web/` to Vercel (Root Directory `web`) and install it on the driver's phone.
2. Run `scripts/test-mark-event.mjs` for the wrong-child rule.
3. Real-van test with the pilot driver. Note the delay, missed taps and feedback.
4. Make rejected-tap errors stay on screen until dismissed.
5. Add a "sent" tick on each child row, using the `sent` value `mark_event` returns.
6. Update the service worker so a new deploy replaces the cached app.
7. Turn off "Automatically expose new tables" and grant `service_role` explicitly in the schema.
8. Deploy Edge Functions with the Supabase CLI instead of pasting code.
