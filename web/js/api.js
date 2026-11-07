import { config } from "./config.js";

export class NetworkError extends Error {
  constructor() {
    super("No network");
    this.name = "NetworkError";
  }
}

export const demoMode =
  !config.supabaseUrl ||
  !config.supabaseAnonKey ||
  new URLSearchParams(location.search).has("demo");

// The admin creates each driver's login with this email and the PIN as the
// password. See docs/setup.md.
export function phoneToEmail(phone) {
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) digits = "91" + digits;
  return `${digits}@tapsafe.local`;
}

function isNetwork(error) {
  return !navigator.onLine || /fetch|network|load failed/i.test(error?.message || "");
}

function unwrap({ data, error }) {
  if (error) {
    if (isNetwork(error)) throw new NetworkError();
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------------ real */

async function makeReal() {
  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"
  );
  const sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  let driver = null;

  async function loadDriver() {
    driver = unwrap(await sb.from("drivers").select("id,name,van_number").maybeSingle());
    return driver;
  }

  return {
    async login(phone, pin) {
      const { error } = await sb.auth.signInWithPassword({
        email: phoneToEmail(phone),
        password: pin,
      });
      if (error) {
        if (isNetwork(error)) throw new NetworkError();
        throw new Error("Wrong phone number or PIN.");
      }
      const d = await loadDriver();
      if (!d) {
        await sb.auth.signOut();
        throw new Error("This login is not linked to a driver. Ask the admin.");
      }
      return d;
    },

    async restore() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      return loadDriver();
    },

    async logout() {
      await sb.auth.signOut();
      driver = null;
    },

    async getChildren() {
      return unwrap(
        await sb
          .from("children")
          .select("id,name,stop,drop_order")
          .order("drop_order", { ascending: true })
      );
    },

    async getActiveTrip() {
      const trip = unwrap(
        await sb.from("trips").select("id,start_time").eq("status", "active").maybeSingle()
      );
      if (!trip) return null;
      const events = unwrap(
        await sb.from("events").select("child_id,type,time").eq("trip_id", trip.id)
      );
      return { ...trip, events };
    },

    async startTrip() {
      const { data, error } = await sb
        .from("trips")
        .insert({ driver_id: driver.id })
        .select("id,start_time")
        .single();
      if (error) {
        if (isNetwork(error)) throw new NetworkError();
        if (error.code === "23505") throw new Error("A trip is already running.");
        throw error;
      }
      return { ...data, events: [] };
    },

    async markEvent({ trip_id, child_id, type }) {
      const { error } = await sb.functions.invoke("mark_event", {
        body: { trip_id, child_id, type },
      });
      if (!error) return;
      if (error.name === "FunctionsFetchError" || !navigator.onLine) throw new NetworkError();
      let message = "Could not save. Try again.";
      try {
        const body = await error.context.json();
        if (body?.error) message = body.error;
      } catch {
        /* keep default */
      }
      const e = new Error(message);
      e.status = error.context?.status;
      throw e;
    },

    async endTrip(tripId) {
      const { error } = await sb.from("trips").update({ status: "completed" }).eq("id", tripId);
      if (!error) return;
      if (isNetwork(error)) throw new NetworkError();
      if (/not dropped/i.test(error.message)) {
        throw new Error("Some children are still on board or not marked.");
      }
      throw error;
    },
  };
}

/* ------------------------------------------------------------------ demo */

function makeDemo() {
  const driver = { id: "demo", name: "Demo driver", van_number: "KA-01-XX-1234" };
  const children = [
    { id: "c1", name: "Aarav", stop: "Park Road", drop_order: 1 },
    { id: "c2", name: "Diya", stop: "Lake View Apartments", drop_order: 2 },
    { id: "c3", name: "Kabir", stop: "Temple Street", drop_order: 3 },
    { id: "c4", name: "Meera", stop: "Garden Layout", drop_order: 4 },
  ];
  let trip = null;
  let signedIn = false;
  const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  return {
    async login() {
      await wait();
      signedIn = true;
      return driver;
    },
    async restore() {
      return signedIn ? driver : null;
    },
    async logout() {
      signedIn = false;
    },
    async getChildren() {
      return children;
    },
    async getActiveTrip() {
      return trip;
    },
    async startTrip() {
      await wait();
      trip = { id: "t1", start_time: new Date().toISOString(), events: [] };
      return trip;
    },
    async markEvent({ child_id, type }) {
      await wait(150);
      trip.events.push({ child_id, type, time: new Date().toISOString() });
    },
    async endTrip() {
      await wait();
      const done = new Set(
        trip.events.filter((e) => e.type !== "boarded").map((e) => e.child_id)
      );
      if (children.some((c) => !done.has(c.id))) {
        throw new Error("Some children are still on board or not marked.");
      }
      trip = null;
    },
  };
}

export const api = demoMode ? makeDemo() : await makeReal();
