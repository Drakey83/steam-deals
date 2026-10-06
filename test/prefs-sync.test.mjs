// "Your taste" edits shared between paired devices: the merge rule (src/shared/core.js) and the desktop sync
// engine against a fake relay. Also that quick successive setting changes are all saved.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const Core = require("../src/shared/core.js");
const createSync = require("../src/main/sync.js");

const RETRO = 4004;
const BOOMER = 1628;
const T = 1_790_000_000_000;

test("the most recent taste edit wins", () => {
  const older = { added: [RETRO], removed: [], at: T };
  const newer = { added: [BOOMER], removed: [RETRO], at: T + 1000 };
  assert.deepEqual(Core.mergeTasteTags(older, newer), newer);
  assert.deepEqual(Core.mergeTasteTags(newer, older), newer);
});

test("when devices first pair, both sides' edits are kept (added beats removed)", () => {
  const pc = { added: [RETRO], removed: [7], at: T };
  const web = { added: [BOOMER], removed: [RETRO], at: T + 5000 };
  const both = Core.mergeTasteTags(pc, web, { combine: true });
  assert.deepEqual(both.added.sort(), [BOOMER, RETRO].sort());
  assert.deepEqual(both.removed, [7]);
  assert.equal(both.at, T + 5000);
});

test("odd input is cleaned, and missing edits count as none", () => {
  assert.deepEqual(Core.cleanTasteTags(null), { added: [], removed: [], at: 0 });
  assert.deepEqual(Core.cleanTasteTags({ added: [1, "2", -1, 1], removed: "x", at: "5" }), { added: [1, 2], removed: [], at: 5 });
  assert.ok(Core.sameTasteTags({ added: [1], removed: [] }, { added: [1], removed: [], at: 0 }));
});

function fakeRelay() {
  const r = { prev: 0, prefs: { tasteTags: { added: [], removed: [], at: 0 } }, sets: 0 };
  r.api = async (action, body) => {
    if (action === "sig") return { rev: 0, arev: 0, prev: r.prev };
    if (action === "basket.get") return { rev: 0, items: [] };
    if (action === "alerts.get") return { rev: 0, alerts: [] };
    if (action === "cart.set") return { ok: true };
    if (action === "prefs.get") return { rev: r.prev, prefs: structuredClone(r.prefs) };
    if (action === "prefs.set") {
      if (body.rev !== r.prev) return { rev: r.prev, prefs: structuredClone(r.prefs), applied: false };
      r.prefs = { tasteTags: Core.cleanTasteTags(body.prefs.tasteTags) };
      r.prev += 1;
      r.sets += 1;
      return { rev: r.prev, prefs: structuredClone(r.prefs), applied: true };
    }
    throw new Error(`unexpected ${action}`);
  };
  r.webSet = (tasteTags) => { r.prefs = { tasteTags }; r.prev += 1; };
  return r;
}

function desktop(relay, tasteTags) {
  const data = { basket: [], mirror: {}, account: null, pairAutoCart: false, pairId: "b".repeat(32), alerts: [], tasteTags, prefsRev: 0 };
  const sent = [];
  const sync = createSync({
    settings: { get: () => data, update: (p) => Object.assign(data, p) },
    steam: {}, cartSession: async () => ({}), sessionFetch: null, pairApi: relay.api,
    sendToUI: (channel, payload) => sent.push({ channel, payload }), version: "1.12.1", shouldNotify: () => false,
  });
  return { data, sent, sync };
}
const until = async (cond, ms = 2000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 5)); } };

test("pairing: the app's and the website's taste edits are combined on both sides", async () => {
  const relay = fakeRelay();
  relay.webSet({ added: [BOOMER], removed: [], at: T + 10 });
  const pc = desktop(relay, { added: [RETRO], removed: [], at: T });
  try {
    await pc.sync.afterPaired();
    await until(() => relay.sets === 1);
    assert.deepEqual(pc.data.tasteTags.added.sort(), [BOOMER, RETRO].sort(), "the app now has both");
    assert.deepEqual(relay.prefs.tasteTags.added.sort(), [BOOMER, RETRO].sort(), "and so does the relay");
    assert.ok(pc.sent.some((m) => m.channel === "settings:changed" && m.payload.tasteTags), "the interface is told");
  } finally {
    pc.sync.stop();
  }
});

test("an edit in the app reaches the relay; a newer edit on the website comes back", async () => {
  const relay = fakeRelay();
  const pc = desktop(relay, { added: [], removed: [], at: 0 });
  try {
    await pc.sync.afterPaired();
    await until(() => pc.data.prefsRev === relay.prev);
    pc.data.tasteTags = { added: [RETRO], removed: [], at: T + 100 };
    pc.sync.onLocalPrefsChange();
    await until(() => relay.prefs.tasteTags.added.includes(RETRO));
    relay.webSet({ added: [RETRO, BOOMER], removed: [], at: T + 200 });
    pc.sync.syncNow(); // the next poll sees the new revision
    await until(() => pc.data.tasteTags.added.includes(BOOMER), 3000);
    assert.equal(pc.data.prefsRev, relay.prev);
  } finally {
    pc.sync.stop();
  }
});
