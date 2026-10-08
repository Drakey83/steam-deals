// Busy mode: a device in use says so on its polls; the relay tells every *other* device, which then checks every
// second (web/api/_lib/relay/channel.js "sig", src/main/sync/index.js).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const channel = require("../web/api/_lib/relay/channel.js");
const createSync = require("../src/main/sync/index.js");

function fakeDb() {
  const hash = { rev: "0" };
  return {
    hash,
    command: async (cmd) => (cmd === "HGETALL" ? Object.entries(hash).flat() : null),
    pipeline: async (cmds) =>
      cmds.map(([cmd, , ...args]) => {
        if (cmd === "HSET") for (let i = 0; i + 1 < args.length; i += 2) hash[args[i]] = args[i + 1];
        if (cmd === "HDEL") for (const f of args) delete hash[f];
        return null;
      }),
  };
}
const id = "d".repeat(32);
const sig = (db, body, now) => channel.sig({ db, body, needPair: () => id, now });

test("a device in use makes the others busy, never itself; it ends 30 s after its last report", async () => {
  const db = fakeDb();
  const t = 1_790_000_000_000;
  assert.equal((await sig(db, { me: "web1", busy: true }, t)).busy, false, "not busy for itself");
  assert.equal((await sig(db, { me: "pc" }, t + 1000)).busy, true, "the PC hears the browser is in use");
  assert.equal((await sig(db, { me: "pc" }, t + 31000)).busy, false, "until it stops reporting");
  await sig(db, { me: "pc", busy: true }, t + 32000);
  assert.ok(!("busy:web1" in db.hash), "a finished device's mark is cleaned up on the next write");
  assert.equal((await sig(db, {}, t + 33000)).busy, true, "an older app (no tag) hears it too");
});

test("odd tags are ignored", async () => {
  const db = fakeDb();
  await sig(db, { me: "NOT A TAG!", busy: true }, 1);
  assert.deepEqual(Object.keys(db.hash), ["rev"]);
});

test("the app says when it's in use, and checks every second while another device is", async () => {
  const calls = [];
  let busyElsewhere = true;
  const pairApi = async (action, body) => {
    if (action === "sig") {
      calls.push({ at: Date.now(), body });
      return { rev: 0, arev: 0, prev: 0, busy: busyElsewhere };
    }
    if (action === "prefs.get") return { rev: 0, prefs: {} };
    if (action === "prefs.set") return { rev: 1, prefs: body.prefs, applied: true };
    return { ok: true, rev: 0, items: [], alerts: [] };
  };
  const data = { basket: [], mirror: {}, account: null, pairAutoCart: false, pairId: id, alerts: [], tasteTags: {}, prefsRev: 0 };
  const sync = createSync({
    settings: { get: () => data, update: (p) => Object.assign(data, p) },
    steam: {}, cartSession: async () => ({}), sessionFetch: null, pairApi, sendToUI: () => {}, version: "1.15.1",
    shouldNotify: () => false, inUse: () => true,
  });
  try {
    sync.nowInUse();
    await new Promise((r) => setTimeout(r, 2600));
    assert.ok(calls.length >= 3, `polled every second while the other device is in use (${calls.length})`);
    assert.deepEqual([calls[0].body.me, calls[0].body.busy], ["pc", true], "and said this app is in use");
    busyElsewhere = false;
    const before = calls.length;
    await new Promise((r) => setTimeout(r, 2200));
    assert.ok(calls.length - before <= 2, "back to slow checks once nobody else is");
  } finally {
    sync.stop();
  }
});
