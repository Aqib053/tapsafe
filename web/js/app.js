import { api, demoMode, NetworkError } from "./api.js";

const OVERDUE_MINUTES = 60;
const root = document.getElementById("app");
const toastEl = document.getElementById("toast");

/* ----------------------------------------------------------------- state */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem("tapsafe." + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("tapsafe." + key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the app still works without it */
    }
  },
  clear(key) {
    try {
      localStorage.removeItem("tapsafe." + key);
    } catch {
      /* ignore */
    }
  },
};

const state = {
  driver: null,
  children: [],
  trip: null,
  events: {}, // child_id -> { boarded, dropped, absent } -> iso time
  queue: store.get("queue", []),
  offline: false,
  armed: null, // child id waiting for a second tap on Absent
  summary: null, // shown on the home screen after a trip ends
  busy: false,
};

function childStatus(id) {
  const e = state.events[id] || {};
  if (e.absent) return "absent";
  if (e.dropped) return "dropped";
  if (e.boarded) return "boarded";
  return "waiting";
}

function setEvent(childId, type, time) {
  state.events[childId] = { ...(state.events[childId] || {}), [type]: time };
}

function clearEvent(childId, type) {
  const next = { ...(state.events[childId] || {}) };
  delete next[type];
  state.events[childId] = next;
}

function applyTrip(trip) {
  state.trip = trip ? { id: trip.id, start_time: trip.start_time } : null;
  state.events = {};
  for (const ev of trip?.events || []) setEvent(ev.child_id, ev.type, ev.time);
}

function saveCache() {
  store.set("cache", {
    driver: state.driver,
    children: state.children,
    trip: state.trip,
    events: state.events,
  });
}

/* --------------------------------------------------------------- helpers */

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function isOverdue(childId) {
  if (childStatus(childId) !== "boarded" || !state.trip) return false;
  const minutes = (Date.now() - new Date(state.trip.start_time).getTime()) / 60000;
  return minutes >= OVERDUE_MINUTES;
}

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4000);
}

/* ------------------------------------------------------------- data flow */

async function refresh() {
  state.children = await api.getChildren();
  applyTrip(await api.getActiveTrip());
  state.offline = false;
  saveCache();
}

async function boot() {
  try {
    state.driver = await api.restore();
    if (state.driver) await refresh();
  } catch (err) {
    const cache = store.get("cache", null);
    if (cache && (err instanceof NetworkError || !navigator.onLine)) {
      Object.assign(state, {
        driver: cache.driver,
        children: cache.children,
        trip: cache.trip,
        events: cache.events,
        offline: true,
      });
    } else {
      toast("Could not load. Check your connection and reopen the app.");
    }
  }
  render();
  flush();
}

let flushing = false;
async function flush() {
  if (flushing || !state.queue.length || !state.trip) return;
  flushing = true;
  while (state.queue.length) {
    const item = state.queue[0];
    try {
      await api.markEvent(item);
      state.queue.shift();
      state.offline = false;
    } catch (err) {
      if (err instanceof NetworkError) {
        state.offline = true;
        break;
      }
      state.queue.shift();
      clearEvent(item.child_id, item.type);
      toast(err.message);
    }
    store.set("queue", state.queue);
    saveCache();
    render();
  }
  store.set("queue", state.queue);
  saveCache();
  flushing = false;
  render();
}

async function tap(childId, type) {
  state.armed = null;
  setEvent(childId, type, new Date().toISOString());
  state.queue.push({ trip_id: state.trip.id, child_id: childId, type });
  store.set("queue", state.queue);
  saveCache();
  render();
  flush();
}

function armAbsent(childId) {
  if (state.armed === childId) return tap(childId, "absent");
  state.armed = childId;
  render();
  setTimeout(() => {
    if (state.armed === childId) {
      state.armed = null;
      render();
    }
  }, 3000);
}

async function startTrip() {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    applyTrip(await api.startTrip());
    state.summary = null;
    saveCache();
  } catch (err) {
    toast(err instanceof NetworkError ? "No network. Start the trip when you are online." : err.message);
  }
  state.busy = false;
  render();
}

async function endTrip() {
  if (state.busy) return;
  if (state.queue.length) return toast("Some taps are not sent yet. Wait a moment.");
  state.busy = true;
  render();
  try {
    await api.endTrip(state.trip.id);
    const statuses = state.children.map((c) => childStatus(c.id));
    state.summary = {
      dropped: statuses.filter((s) => s === "dropped").length,
      absent: statuses.filter((s) => s === "absent").length,
      at: new Date().toISOString(),
    };
    applyTrip(null);
    saveCache();
  } catch (err) {
    toast(err instanceof NetworkError ? "No network. Try again when you are online." : err.message);
  }
  state.busy = false;
  render();
}

async function signOut() {
  if (state.queue.length) return toast("Some taps are not sent yet. Wait before signing out.");
  await api.logout();
  state.driver = null;
  state.trip = null;
  state.summary = null;
  store.clear("cache");
  render();
}

/* ------------------------------------------------------------------ views */

function banner() {
  const parts = [];
  if (demoMode) parts.push(h("p", { class: "banner" }, "Demo mode. Nothing is saved and no message is sent."));
  if (state.offline || state.queue.length) {
    const n = state.queue.length;
    parts.push(
      h(
        "p",
        { class: "banner warn" },
        state.offline ? "No network. " : "",
        n ? `${n} ${n === 1 ? "tap" : "taps"} saved on this phone, not sent yet.` : "Showing saved data."
      )
    );
  }
  return parts;
}

function loginView() {
  const message = h("p", { class: "error", role: "alert" });
  const phone = h("input", {
    id: "phone", name: "phone", type: "tel", inputmode: "numeric",
    autocomplete: "username", required: true,
  });
  const pin = h("input", {
    id: "pin", name: "pin", type: "password", inputmode: "numeric",
    autocomplete: "current-password", required: true,
  });
  const submit = h("button", { class: "btn primary block", type: "submit" }, "Sign in");

  const form = h(
    "form",
    {
      class: "card stack",
      onsubmit: async (e) => {
        e.preventDefault();
        message.textContent = "";
        submit.disabled = true;
        try {
          state.driver = await api.login(phone.value, pin.value);
          await refresh();
          render();
        } catch (err) {
          message.textContent =
            err instanceof NetworkError ? "No network. Try again when you are online." : err.message;
          submit.disabled = false;
        }
      },
    },
    h("div", { class: "field" }, h("label", { for: "phone" }, "Phone number"), phone),
    h("div", { class: "field" }, h("label", { for: "pin" }, "PIN"), pin),
    message,
    submit
  );

  return h(
    "main",
    { class: "page" },
    banner(),
    h("h1", { class: "brand" }, "TapSafe"),
    h("p", { class: "lede" }, "Sign in to start the afternoon trip."),
    form
  );
}

function homeView() {
  const s = state.summary;
  return h(
    "main",
    { class: "page" },
    banner(),
    topbar(),
    h(
      "section",
      { class: "card stack" },
      h("h2", {}, "Afternoon trip"),
      h("p", { class: "muted" }, `${state.children.length} ${state.children.length === 1 ? "child" : "children"} on this van.`),
      s &&
        h(
          "p",
          { class: "done" },
          `Last trip ended ${clock(s.at)}. ${s.dropped} home` + (s.absent ? `, ${s.absent} absent.` : ".")
        ),
      h(
        "button",
        {
          class: "btn primary block big",
          disabled: state.busy || !state.children.length || state.offline,
          onclick: startTrip,
        },
        state.busy ? "Starting…" : "Start trip"
      ),
      !state.children.length && h("p", { class: "muted" }, "No children are assigned to this van yet.")
    )
  );
}

function tripView() {
  const unresolved = state.children.filter((c) => {
    const s = childStatus(c.id);
    return s === "waiting" || s === "boarded";
  });
  const resolved = state.children.length - unresolved.length;
  const canEnd = !unresolved.length && !state.queue.length && !state.busy;

  return h(
    "main",
    { class: "page" },
    banner(),
    topbar(`Started ${clock(state.trip.start_time)}`),
    h(
      "p",
      { class: "progress", "aria-live": "polite" },
      h("strong", {}, `${resolved} of ${state.children.length}`),
      " done"
    ),
    h("ul", { class: "list" }, state.children.map(childRow)),
    h(
      "div",
      { class: "endbar" },
      !canEnd && unresolved.length
        ? h("p", { class: "muted" }, `${unresolved.length} still to mark`)
        : null,
      h(
        "button",
        { class: "btn block " + (canEnd ? "primary" : ""), disabled: !canEnd, onclick: endTrip },
        state.busy ? "Ending…" : "End trip"
      )
    )
  );
}

function childRow(child) {
  const status = childStatus(child.id);
  const ev = state.events[child.id] || {};
  const overdue = isOverdue(child.id);

  let chip = null;
  let actions = null;

  if (status === "waiting") {
    actions = [
      h("button", { class: "btn primary", onclick: () => tap(child.id, "boarded") }, "Boarded"),
      h(
        "button",
        { class: "btn quiet" + (state.armed === child.id ? " armed" : ""), onclick: () => armAbsent(child.id) },
        state.armed === child.id ? "Confirm absent" : "Absent"
      ),
    ];
  } else if (status === "boarded") {
    chip = h("span", { class: "chip" + (overdue ? " warn" : "") }, overdue ? "Overdue" : `On board ${clock(ev.boarded)}`);
    actions = [h("button", { class: "btn primary", onclick: () => tap(child.id, "dropped") }, "Dropped")];
  } else if (status === "dropped") {
    chip = h("span", { class: "chip ok" }, `Home ${clock(ev.dropped)}`);
  } else {
    chip = h("span", { class: "chip" }, "Absent");
  }

  return h(
    "li",
    { class: "row " + status },
    h(
      "div",
      { class: "who" },
      h("p", { class: "name" }, child.name),
      h("p", { class: "stop" }, child.stop),
      chip
    ),
    actions && h("div", { class: "actions" }, actions)
  );
}

function topbar(sub) {
  return h(
    "header",
    { class: "topbar" },
    h(
      "div",
      {},
      h("p", { class: "van" }, state.driver.van_number),
      h("p", { class: "muted small" }, sub || state.driver.name)
    ),
    !state.trip && h("button", { class: "btn quiet", onclick: signOut }, "Sign out")
  );
}

function render() {
  root.replaceChildren(
    !state.driver ? loginView() : state.trip ? tripView() : homeView()
  );
}

/* ---------------------------------------------------------------- wiring */

window.addEventListener("online", () => {
  state.offline = false;
  render();
  flush();
});
window.addEventListener("offline", () => {
  state.offline = true;
  render();
});
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !state.driver) return;
  if (state.queue.length) return flush();
  try {
    await refresh();
    render();
  } catch {
    /* keep what is on screen */
  }
});
setInterval(() => {
  if (state.trip) render(); // refresh the overdue chip
  flush();
}, 30000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
