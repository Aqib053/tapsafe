# TapSafe: context for Claude Code

## What this is

TapSafe sends a parent a Telegram message when their child boards a private school van and again when the child reaches home. The driver taps once per child. Pilot: one van in Bangalore, run by me with my cousin's driver and 2 to 3 parents. No school is involved.

## Current state

- `index.html` is a clickable prototype (driver app and parent view). State lives in memory. Nothing is saved and no message is sent.
- No backend, database or bot exists yet.
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

- `drivers`: name, phone, van_number
- `parents`: name, phone, telegram_chat_id
- `children`: name, parent_id, driver_id, stop, drop_order
- `trips`: driver_id, start_time, end_time, status (`active` or `completed`)
- `events`: trip_id, child_id, type (`boarded`, `dropped` or `absent`), time

Trips and events are created by the app each day. The other tables change rarely.

## Rules the app must follow

1. **Start Trip** creates a trip. Each tap creates an event and sends a Telegram message to the parent.
2. **End Trip** is blocked while any child is still `boarded` or has no status yet.
3. **Overdue check:** if a child is `boarded` and not `dropped` 60 minutes after the trip started, message the parent and the driver. Run it with pg_cron every 5 to 10 minutes. Remind each child once.
4. **Wrong child:** if a scanned child is not on this van's list, the phone beeps and shows "Not on your list", and that child's parent is alerted.
5. **Offline:** taps are saved on the phone and sent when the network returns.

## Message text

- `Rahul boarded KA-01-XX-1234`
- `Rahul reached home`
- `Rahul was marked absent today`
- `Rahul has not been dropped yet. Please call the driver.`

## Constraints

- Never commit the Telegram bot token, the Supabase service role key or any real child or parent data. Keep them in Supabase and Vercel settings.
- Turn on Row Level Security for every table. The public anon key must not expose parent phone numbers or Telegram chat IDs.
- Use the service role key only inside Edge Functions.
- The driver's phone is Android on mobile data. Keep the driver screen to one tap per child.

## Writing style

Keep UI text and messages short and plain. No filler openers, no slogans.

## Next steps

1. Write `supabase/schema.sql` for the five tables with Row Level Security.
2. Create the Telegram bot and send a test message.
3. Connect the driver buttons in `index.html` to Supabase.
4. Write the `mark_event` Edge Function that saves an event and sends the message.
5. Write the `check_overdue` function and schedule it with pg_cron.
6. Add the offline queue.