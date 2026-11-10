// Tells Telegram to send bot messages to the telegram_webhook function.
// Run once, and again only if the secret changes.
//
//   node scripts/set-webhook.mjs
//
// It asks for two values and never stores them:
//   - the bot token (from BotFather)
//   - the webhook secret: the same string you saved as the Edge Function
//     secret TELEGRAM_WEBHOOK_SECRET (letters, digits, _ and - only)

import { readFileSync } from "node:fs";
import readline from "node:readline/promises";

const cfg = readFileSync(new URL("../web/js/config.js", import.meta.url), "utf8");
const base = cfg.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
if (!base) {
  console.error("web/js/config.js has no Supabase URL.");
  process.exit(2);
}

async function hidden(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let muted = false;
  const write = rl._writeToOutput;
  rl._writeToOutput = (s) => (muted ? undefined : write.call(rl, s));
  const pending = rl.question(label);
  muted = true;
  const value = (await pending).trim();
  rl.close();
  console.log("");
  return value;
}

const token = await hidden("Bot token: ");
const secret = await hidden("Webhook secret: ");
if (!token || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  console.error("Missing token, or the secret is not 16+ letters, digits, _ or -.");
  process.exit(2);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: `${base}/functions/v1/telegram_webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
  }),
});
const body = await res.json().catch(() => ({}));
console.log(body.ok ? "Webhook set." : `Failed: ${body.description ?? res.status}`);
process.exit(body.ok ? 0 : 1);
