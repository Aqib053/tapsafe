// Checks that mark_event rejects bad requests, including a child who is not
// on the signed-in driver's list (rule 4).
//
// Usage:
//   PHONE=<driver 10-digit phone> CHILD_ID=<id of a child that belongs to a
//   DIFFERENT driver> node scripts/test-mark-event.mjs
//
// The PIN is asked for in the terminal and is never stored. If that child's
// parent has a telegram_chat_id, they get the wrong-van alert, so use a test
// parent. Nothing is written to the events table by these checks.

import { readFileSync } from "node:fs";
import readline from "node:readline/promises";

const phone = process.env.PHONE;
const childId = process.env.CHILD_ID;
if (!phone || !childId) {
  console.error("Set PHONE and CHILD_ID. See the top of this file.");
  process.exit(2);
}

const cfg = readFileSync(new URL("../web/js/config.js", import.meta.url), "utf8");
const url = cfg.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const key = cfg.match(/supabaseAnonKey:\s*"([^"]+)"/)?.[1];
if (!url || !key) {
  console.error("web/js/config.js has no Supabase URL or key.");
  process.exit(2);
}

async function askPin() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let muted = false;
  const write = rl._writeToOutput;
  rl._writeToOutput = (s) => (muted ? undefined : write.call(rl, s));
  const pending = rl.question("PIN: ");
  muted = true;
  const pin = await pending;
  rl.close();
  console.log("");
  return pin;
}

const email = `${phone.replace(/\D/g, "").slice(-10)}@tapsafe.local`;
const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: await askPin() }),
});
if (!login.ok) {
  console.error("Sign-in failed. Check the phone number and PIN.");
  process.exit(1);
}
const { access_token: token } = await login.json();

const NIL = "00000000-0000-0000-0000-000000000000";

async function call(body, bearer) {
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${url}/functions/v1/mark_event`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, error: json.error };
}

const checks = [
  {
    name: "no sign-in is rejected",
    run: () => call({ trip_id: NIL, child_id: childId, type: "boarded" }, null),
    want: (r) => r.status === 401,
  },
  {
    name: "unknown tap type is rejected",
    run: () => call({ trip_id: NIL, child_id: childId, type: "waved" }, token),
    want: (r) => r.status === 400,
  },
  {
    name: "child from another van: 403 Not on your list",
    run: () => call({ trip_id: NIL, child_id: childId, type: "boarded" }, token),
    want: (r) => r.status === 403 && r.error === "Not on your list",
  },
];

let failed = 0;
for (const c of checks) {
  const r = await c.run();
  const ok = c.want(r);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  (got ${r.status}${r.error ? ", " + r.error : ""})`);
}
process.exit(failed ? 1 : 0);
