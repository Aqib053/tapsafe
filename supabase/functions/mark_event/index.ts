// mark_event: saves a boarded / dropped / absent tap and messages the parent.
// Runs with the service role key (set by Supabase). The caller must be a
// signed-in driver, and the child and trip must belong to that driver.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function telegram(chatId: number | null, text: string): Promise<boolean> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) console.error("telegram failed", res.status);
    return res.ok;
  } catch (err) {
    console.error("telegram error", String(err));
    return false;
  }
}

const TYPES = ["boarded", "dropped", "absent"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "POST only." });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Who is calling
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return reply(401, { error: "Sign in again." });

  const { data: driver } = await admin
    .from("drivers")
    .select("id, van_number")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (!driver) return reply(403, { error: "This login is not linked to a driver." });

  // Input
  let body: { trip_id?: string; child_id?: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Bad request." });
  }
  const { trip_id, child_id, type } = body;
  if (!trip_id || !child_id || !type || !TYPES.includes(type)) {
    return reply(400, { error: "Bad request." });
  }

  // Child and the parent to message
  const { data: child } = await admin
    .from("children")
    .select("id, name, driver_id, parents(telegram_chat_id)")
    .eq("id", child_id)
    .maybeSingle();
  if (!child) return reply(404, { error: "Child not found." });

  const chatId = (child.parents as { telegram_chat_id: number | null } | null)
    ?.telegram_chat_id ?? null;

  // Rule 4: wrong child
  if (child.driver_id !== driver.id) {
    await telegram(
      chatId,
      `${child.name} was marked on a van that is not theirs. Please call the driver.`,
    );
    return reply(403, { error: "Not on your list" });
  }

  // The trip must be this driver's and still active
  const { data: trip } = await admin
    .from("trips")
    .select("id, status")
    .eq("id", trip_id)
    .eq("driver_id", driver.id)
    .maybeSingle();
  if (!trip) return reply(404, { error: "Trip not found." });
  if (trip.status !== "active") return reply(409, { error: "This trip has ended." });

  // Order of taps
  const { data: existing } = await admin
    .from("events")
    .select("type")
    .eq("trip_id", trip_id)
    .eq("child_id", child_id);
  const done = new Set((existing ?? []).map((e) => e.type));

  if (done.has(type)) return reply(200, { ok: true, duplicate: true });
  if (type === "dropped" && !done.has("boarded")) {
    return reply(409, { error: "Mark boarded first." });
  }
  if (type === "boarded" && done.has("absent")) {
    return reply(409, { error: "Already marked absent." });
  }
  if (type === "absent" && done.has("boarded")) {
    return reply(409, { error: "Already on board." });
  }

  const { error } = await admin.from("events").insert({ trip_id, child_id, type });
  if (error) {
    if (error.code === "23505") return reply(200, { ok: true, duplicate: true });
    console.error("insert failed", error.code);
    return reply(500, { error: "Could not save. Try again." });
  }

  // The tap is saved. A Telegram failure must not undo it.
  const text = type === "boarded"
    ? `${child.name} boarded ${driver.van_number}`
    : type === "dropped"
    ? `${child.name} reached home`
    : `${child.name} was marked absent today`;
  const sent = await telegram(chatId, text);

  return reply(200, { ok: true, sent });
});
