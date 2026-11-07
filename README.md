# TapSafe

Parents get a Telegram message when their child boards a private school van and again when the child reaches home. The driver taps once per child.

**Status:** pilot with one van. `index.html` is a clickable prototype. Nothing is saved yet and no messages are sent.

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
index.html        clickable prototype (driver app and parent view)
CLAUDE.md         project context for Claude Code
docs/             pilot notes and decisions
supabase/         database schema (to be added)
```

## Try the prototype

Open `index.html` in a browser. Log in as the driver, start the trip and tap the buttons. The parent view updates as you go.

## Privacy

This repository must never contain:

- the Telegram bot token
- the Supabase service role key
- real child names, parent names or phone numbers

Keep secrets in Supabase and Vercel settings. Keep real data in the database.