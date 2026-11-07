# Setup

Order matters. Test on yourself first, then add the van.

## 1. Try the app with no backend

Open the site with `?demo` on the end, for example `http://localhost:8000/?demo`. Any phone and PIN work. Nothing is saved.

Serve the folder locally with `python3 -m http.server 8000`.

## 2. Supabase

1. Create a free project.
2. Run `supabase/schema.sql` in the SQL editor.
3. In **Authentication > Users**, add a driver login:
   - Email: the phone number with country code, then `@tapsafe.local`. Example: `919999999999@tapsafe.local`.
   - Password: the driver's PIN. Supabase may require 6 or more characters, so use a 6-digit PIN.
   - Turn on "Auto confirm user".
4. In the table editor, add rows. Use your own details for the first test.
   - `drivers`: name, phone, van_number, and `auth_user_id` set to the user id from step 3.
   - `parents`: name, phone, and `telegram_chat_id`.
   - `children`: name, `parent_id`, `driver_id`, stop, `drop_order`.
5. Copy the project URL and the **anon** key into `config.js`. Never copy the service role key anywhere in this repo.

## 3. Telegram (test on yourself)

1. In Telegram, message @BotFather, send `/newbot`, and follow the prompts. Save the token in Supabase secrets, not in the repo.
2. Open your new bot and press Start.
3. Get your chat id: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and read `message.chat.id`. Do this in a private window and do not share the URL.
4. Put that id in your own `parents` row. You are the parent for the first test.

## 4. Deploy

1. Push the repo to GitHub.
2. In Vercel, import the repo. Framework preset: **Other**. No build command. No output directory.
3. Open the Vercel URL on the Android phone and use **Add to Home screen**.
