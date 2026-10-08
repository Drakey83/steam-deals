// The shared preferences between paired devices (filters and view, "Your taste" edits, Not interested, behaviour):
// the merge rules (src/shared/sharing.js), the relay keeping what older apps don't send, and the desktop sync
// engine against a fake relay. Also that quick successive setting changes are all saved.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const Sharing = require("../src/shared/sharing.js");
const createSync = require("../src/main/sync/index.js");

const RETRO = 4004;
const BOOMER = 1628;
const T = 1_790_000_000_000;

test("the most recent taste edit wins", () => {
  const older = { added: [RETRO], removed: [], at: T };
  const newer = { added: [BOOMER], removed: [RETRO], at: T + 1000 };
  assert.deepEqual(Sharing.mergeTasteTags(older, newer), newer);
  assert.deepEqual(Sharing.mergeTasteTags(newer, older), newer);
});

test("when devices first pair, both sides' edits are kept (added beats removed)", () => {
  const pc = { added: [RETRO], removed: [7], at: T };
  const web = { added: [BOOMER], removed: [RETRO], at: T + 5000 };
  const both = Sharing.mergeTasteTags(pc, web, { combine: true });
  assert.deepEqual(both.added.sort(), [BOOMER, RETRO].sort());
  assert.deepEqual(both.removed, [7]);
  assert.equal(both.at, T + 5000);
});

test("odd input is cleaned, and missing edits count as none", () => {
  assert.deepEqual(Sharing.cleanTasteTags(null), { added: [], removed: [], at: 0 });
  assert.deepEqual(Sharing.cleanTasteTags({ added: [1, "2", -1, 1], removed: "x", at: "5" }), { added: [1, 2], removed: [], at: 5 });
  assert.ok(Sharing.sameTasteTags({ added: [1], removed: [] }, { added: [1], removed: [], at: 0 }));
});

function fakeRelay() {
  const r = { prev: 0, prefs: Sharing.cleanPrefs({}), sets: 0 };
  r.api = async (action, body) => {
    if (action === "sig") return { rev: 0, arev: 0, prev: r.prev };
    if (action === "basket.get") return { rev: 0, items: [] };
    if (action === "alerts.get") return { rev: 0, alerts: [] };
    if (action === "cart.set") return { ok: true };
    if (action === "prefs.get") return { rev: r.prev, prefs: structuredClone(r.prefs) };
    if (action === "prefs.set") {
      if (body.rev !== r.prev) return { rev: r.prev, prefs: structuredClone(r.prefs), applied: false };
      r.prefs = Sharing.cleanPrefs(body.prefs);
      r.prev += 1;
      r.sets += 1;
      return { rev: r.prev, prefs: structuredClone(r.prefs), applied: true };
    }
    throw new Error(`unexpected ${action}`);
  };
  r.webSet = (tasteTags) => { r.prefs = { ...r.prefs, tasteTags }; r.prev += 1; };
  r.webSetDoc = (patch) => { r.prefs = Sharing.cleanPrefs({ ...r.prefs, ...patch }); r.prev += 1; };
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

// ----- filters, Not interested and behaviour -----

const filters = (values, at) => ({ values, at });
const gameA = { appid: 10, name: "A", tags: [{ id: RETRO, w: 1 }] };
const gameB = { appid: 20, name: "B", tags: [{ id: BOOMER, w: 1 }] };

test("filters: the newer set wins as a whole; a copy without filters never wipes them", () => {
  const pc = { filters: filters({ minDiscount: 70, minRating: 70, view: "foryou" }, T) };
  const web = { filters: filters({ minDiscount: 50, minRating: 80, view: "all" }, T + 1) };
  assert.deepEqual(Sharing.mergePrefs(pc, web).filters.values, web.filters.values);
  assert.deepEqual(Sharing.mergePrefs(web, pc).filters.values, web.filters.values);
  assert.deepEqual(Sharing.mergePrefs(pc, { tasteTags: {} }).filters.values, pc.filters.values, "an older app's document has none");
});

test("filters are cleaned to known keys and values", () => {
  const f = Sharing.cleanPrefs({ filters: { values: { minDiscount: "40", sort: "evil", view: "all", catalog: "x", weights: { discount: 1, rating: 2, popularity: 3 }, hideOwned: "yes", country: "US" }, at: T } }).filters;
  assert.deepEqual(f, { values: { view: "all", minDiscount: 40, weights: { discount: 1, rating: 2, popularity: 3 } }, at: T });
});

test("Not interested: a game dismissed on either device stays dismissed; a restore on one isn't undone by the other", () => {
  const pc = { dismissed: [{ ...gameA, at: T }] };
  const web = { dismissed: [{ ...gameB, at: T + 5 }] };
  assert.deepEqual(Sharing.mergePrefs(pc, web).dismissed.map((d) => d.appid), [20, 10]);
  // The website restores A later; the app still has it.
  const restoredOnWeb = { dismissed: [{ ...gameB, at: T + 5 }], restored: [{ appid: 10, at: T + 9 }] };
  const merged = Sharing.mergePrefs({ dismissed: [{ ...gameA, at: T }, { ...gameB, at: T + 5 }] }, restoredOnWeb);
  assert.deepEqual(merged.dismissed.map((d) => d.appid), [20]);
  // Dismissed again afterwards: the newer dismissal wins over the restore.
  const again = Sharing.mergePrefs({ dismissed: [{ ...gameA, at: T + 20 }] }, merged);
  assert.deepEqual(again.dismissed.map((d) => d.appid).sort(), [10, 20]);
});

test("behaviour: every device's events count once; a reset forgets everything older on every device", () => {
  const ev = (type, appid, at) => ({ type, appid, tags: [{ id: RETRO, w: 1 }], at });
  const pc = { behavior: [ev("opened", 10, T + 2), ev("basket", 20, T)] };
  const web = { behavior: [ev("opened", 30, T + 3), ev("basket", 20, T)] };
  assert.deepEqual(Sharing.mergePrefs(pc, web).behavior.map((e) => e.appid), [30, 10, 20]);
  const reset = Sharing.mergePrefs(pc, { behavior: [], behaviorClearedAt: T + 2 });
  assert.deepEqual(reset.behavior, []);
  assert.deepEqual(Sharing.mergePrefs({ behavior: [ev("opened", 40, T + 9)] }, reset).behavior.map((e) => e.appid), [40], "newer events still count");
});

test("a local change records what other devices need: a filter stamp, a restore mark, a reset time", () => {
  const before = { minDiscount: 50, dismissed: [{ ...gameA, at: T }, { ...gameB, at: T }], behavior: [{ type: "opened", appid: 1, at: T }] };
  assert.deepEqual(Sharing.notePrefsEdit(before, { minDiscount: 50 }, T + 1), {}, "the same value isn't a change");
  assert.deepEqual(Sharing.notePrefsEdit(before, { minDiscount: 25 }, T + 1), { filtersAt: T + 1 });
  assert.deepEqual(Sharing.notePrefsEdit(before, { dismissed: [{ ...gameB, at: T }] }, T + 1), { dismissRestored: [{ appid: 10, at: T + 1 }] });
  assert.deepEqual(Sharing.notePrefsEdit(before, { behavior: [] }, T + 1), { behaviorClearedAt: T + 1 });
});

test("the relay keeps the rest of the document when an older app writes only its taste edits", async () => {
  const docs = require("../web/api/_lib/relay/shared-docs.js");
  const store = { doc: JSON.stringify(Sharing.cleanPrefs({ filters: filters({ minDiscount: 25 }, T), dismissed: [{ ...gameA, at: T }] })), rev: "3" };
  const db = {
    pipeline: async () => [store.doc, store.rev],
    command: async (cmd, ...args) => {
      assert.equal(cmd, "EVAL");
      if (args[4] !== store.rev) return 0;
      store.doc = args[5];
      store.rev = args[6];
      return 1;
    },
  };
  const r = await docs["prefs.set"]({ db, body: { prefs: { tasteTags: { added: [RETRO], removed: [], at: T } }, rev: 3 }, alive: async () => "e".repeat(32) });
  assert.equal(r.applied, true);
  const saved = JSON.parse(store.doc);
  assert.deepEqual(saved.tasteTags.added, [RETRO]);
  assert.deepEqual(saved.filters.values, { minDiscount: 25 }, "filters kept");
  assert.deepEqual(saved.dismissed.map((d) => d.appid), [10], "Not interested kept");
});

test("a filter changed on the website reaches the app and its interface; a change in the app goes back", async () => {
  const relay = fakeRelay();
  const pc = desktop(relay, { added: [], removed: [], at: 0 });
  Object.assign(pc.data, { minDiscount: 70, minRating: 70, view: "foryou", filtersAt: T });
  try {
    await pc.sync.afterPaired();
    await until(() => pc.data.prefsRev === relay.prev && relay.prefs.filters.values.minDiscount === 70);
    relay.webSetDoc({ filters: filters({ minDiscount: 50, minRating: 80, view: "all" }, T + 100) });
    pc.sync.syncNow();
    await until(() => pc.data.minDiscount === 50, 3000);
    assert.equal(pc.data.view, "all");
    const told = pc.sent.findLast((m) => m.channel === "settings:changed").payload;
    assert.equal(told.minDiscount, 50, "the interface is told");
    assert.equal(told.minRating, 80);
    Object.assign(pc.data, { wishlistOnly: true, filtersAt: T + 200 });
    pc.sync.onLocalPrefsChange();
    await until(() => relay.prefs.filters.values.wishlistOnly === true);
    assert.equal(relay.prefs.filters.values.minDiscount, 50);
  } finally {
    pc.sync.stop();
  }
});

test("a second change made while the first is still being written is written too", async () => {
  const relay = fakeRelay();
  const pc = desktop(relay, { added: [], removed: [], at: 0 });
  try {
    await pc.sync.afterPaired();
    await until(() => pc.data.prefsRev === relay.prev);
    const set = relay.api;
    relay.api = async (action, body) => (action === "prefs.set" ? new Promise((r) => setTimeout(() => r(set(action, body)), 50)) : set(action, body));
    Object.assign(pc.data, { catalog: "all", filtersAt: T + 1 });
    pc.sync.onLocalPrefsChange();
    Object.assign(pc.data, { sort: "price", filtersAt: T + 2 });
    pc.sync.onLocalPrefsChange(); // while the first write is still on its way
    await until(() => relay.prefs.filters.values.sort === "price");
    assert.equal(relay.prefs.filters.values.catalog, "all");
  } finally {
    pc.sync.stop();
  }
});
