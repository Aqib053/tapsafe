# TapSafe

Parents get a Telegram message when their child boards a private school van and again when the child reaches home. The driver taps once per child.

**Status:** pilot with one van. The driver app works in demo mode. The Supabase function that saves taps and sends Telegram messages is not written yet.

## How a trip works (school pickup to home drop)

1. The driver logs in and taps **Start Trip**. The app lists the children in drop order.
2. A child boards. The driver taps **Boarded**. The parent gets a message.
3. At each home stop the driver taps **Dropped**. The parent gets another message.
4. If a child is absent, the driver taps **Absent**.
5. **End Trip** stays locked while any child is still on board.
6. If a child is boarded but not dropped 60 minutes after the trip started, the parent and the driver get a reminder.

## Planned stack (free tiers)

| Part | Tool |
|---|---|
| App | Web app (PWA) |
| Hosting | Vercel |
| Database and login | Supabase |
| Alerts | Supabase Edge Functions and a Telegram bot |
| Overdue check | pg_cron |

## Folders

```
web/              the driver app (static, no build step)
  index.html
  sw.js, manifest.webmanifest
  js/             app.js (screens, offline queue), api.js (Supabase and demo mode), config.js
  css/            styles.css
  icons/
supabase/         database schema, later Edge Functions
docs/             setup steps and notes
CLAUDE.md         project context for Claude Code
```

## Try it

Run `python3 -m http.server 8000 --directory web` and open `http://localhost:8000/?demo`. Any phone and PIN work. Nothing is saved or sent. See `docs/setup.md` for the real setup.

## Privacy

This repository must never contain:

- the Telegram bot token
- the Supabase service role key
- real child names, parent names or phone numbers

Keep secrets in Supabase and Vercel settings. Keep real data in the database.