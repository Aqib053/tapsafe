// telegram_webhook: Telegram calls this for every message sent to the bot.
// When a parent opens their invite link and presses Start, the message is
// "/start <invite_code>". We save the sender's chat id on that parent's row.
//
// Telegram sends the secret set with setWebhook in a header. Without it the
// request is refused, so nobody else can post fake updates here.

import { createClient } from "npm:@supabase/supabase-js@2";

const ok = () => new Response("ok");

async function send(chatId: number, text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) console.error("telegram failed", res.status);
  } catch (err) {
    console.error("telegram error", String(err));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok();

  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!expected || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== expected) {
    return new Response("Not allowed", { status: 401 });
  }

  let update: { message?: { text?: unknown; chat?: { id?: number; type?: string } } };
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  if (!chatId || msg?.chat?.type !== "private") return ok();

  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text.startsWith("/start")) return ok();

  const match = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{8,64})$/);
  if (!match) {
    await send(chatId, "Use the link you were sent to get alerts.");
    return ok();
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: parent } = await admin
    .from("parents")
    .select("id, telegram_chat_id")
    .eq("invite_code", match[1])
    .maybeSingle();
  if (!parent) {
    await send(chatId, "That link is not valid.");
    return ok();
  }

  // Save only if the row is empty or already holds this same chat. A link that
  // was forwarded to someone else cannot take over an existing parent.
  const { data: linked } = await admin
    .from("parents")
    .update({ telegram_chat_id: chatId })
    .eq("id", parent.id)
    .or(`telegram_chat_id.is.null,telegram_chat_id.eq.${chatId}`)
    .select("id");
  if (!linked?.length) {
    await send(chatId, "This link has already been used. Ask the person who sent it.");
    return ok();
  }

  const { data: children } = await admin
    .from("children")
    .select("name")
    .eq("parent_id", parent.id)
    .order("name");
  const names = (children ?? []).map((c) => c.name).join(", ");
  await send(chatId, names ? `You will get alerts for ${names}.` : "You are connected.");

  return ok();
});
