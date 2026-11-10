// check_overdue: runs every few minutes from pg_cron.
// If a child is boarded, not dropped or absent, and the trip started more than
// OVERDUE_MINUTES ago, message the parent and the driver. Each child is
// reminded once (events.overdue_notified_at).

import { createClient } from "npm:@supabase/supabase-js@2";

const MINUTES = Number(Deno.env.get("OVERDUE_MINUTES") ?? "60");

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

Deno.serve(async (req) => {
  // Only the scheduler knows this secret.
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return json(401, { error: "Not allowed." });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - MINUTES * 60_000).toISOString();

  // Active trips that have run long enough
  const { data: trips, error: tripsError } = await admin
    .from("trips")
    .select("id, drivers(telegram_chat_id)")
    .eq("status", "active")
    .lte("start_time", cutoff);
  if (tripsError) {
    console.error("trips query failed", tripsError.code);
    return json(500, { error: "Query failed." });
  }
  if (!trips?.length) return json(200, { overdue: 0, notified: 0 });

  const { data: events, error: eventsError } = await admin
    .from("events")
    .select("id, trip_id, child_id, type, overdue_notified_at")
    .in("trip_id", trips.map((t) => t.id));
  if (eventsError) {
    console.error("events query failed", eventsError.code);
    return json(500, { error: "Query failed." });
  }

  // A child is finished once they have a dropped or absent event.
  const finished = new Set(
    (events ?? []).filter((e) => e.type !== "boarded").map((e) => `${e.trip_id}:${e.child_id}`),
  );
  const overdue = (events ?? []).filter(
    (e) =>
      e.type === "boarded" &&
      !e.overdue_notified_at &&
      !finished.has(`${e.trip_id}:${e.child_id}`),
  );
  if (!overdue.length) return json(200, { overdue: 0, notified: 0 });

  const { data: children } = await admin
    .from("children")
    .select("id, name, parents(telegram_chat_id)")
    .in("id", [...new Set(overdue.map((e) => e.child_id))]);
  const childById = new Map((children ?? []).map((c) => [c.id, c]));
  const tripById = new Map(trips.map((t) => [t.id, t]));

  let notified = 0;
  for (const ev of overdue) {
    const child = childById.get(ev.child_id);
    const trip = tripById.get(ev.trip_id);
    if (!child || !trip) continue;

    // Claim the reminder first. If another run already took it, skip.
    const { data: claimed } = await admin
      .from("events")
      .update({ overdue_notified_at: new Date().toISOString() })
      .eq("id", ev.id)
      .is("overdue_notified_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const parentChat =
      (child.parents as unknown as { telegram_chat_id: number | null } | null)
        ?.telegram_chat_id ?? null;
    const driverChat =
      (trip.drivers as unknown as { telegram_chat_id: number | null } | null)
        ?.telegram_chat_id ?? null;

    const [toParent, toDriver] = await Promise.all([
      telegram(parentChat, `${child.name} has not been dropped yet. Please call the driver.`),
      telegram(driverChat, `${child.name} has not been dropped yet.`),
    ]);

    if (toParent || toDriver) {
      notified++;
    } else {
      // Nobody could be reached. Release the claim so a later run can retry.
      await admin.from("events").update({ overdue_notified_at: null }).eq("id", ev.id);
    }
  }

  return json(200, { overdue: overdue.length, notified });
});
