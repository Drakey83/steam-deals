// Price alerts shared between the website and the paired Windows app: the merge rules (src/shared/core.js),
// who checks (logic/alerts.js), and the desktop sync engine against a fake relay.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { alertsCheckedByPc, checkAlerts, makeAlert, upsertAlert } from "../src/renderer/logic/alerts.js";

const require = createRequire(import.meta.url);
const Core = require("../src/shared/core.js");
const createSync = require("../src/main/sync.js");

const T0 = Date.UTC(2026, 9, 1);
const game = (appid, priceCents) => ({ appid, name: `Game ${appid}`, price: `$${(priceCents / 100).toFixed(2)}`, priceCents });
const webAlert = (appid, target, price, at = T0) => ({ ...makeAlert(game(appid, price), target, "US", at), origin: "web" });

// ----- merging -----
test("the app adds the website's alerts to its own and marks them as from the website", () => {
  const local = [makeAlert(game(1, 999), 499, "US", T0)];
  const merged = Core.mergeWebAlerts(local, [{ ...makeAlert(game(2, 1999), 999, "US", T0 + 1) }]);
  assert.deepEqual(merged.map((a) => [a.appid, a.origin ?? "app"]), [[2, "web"], [1, "app"]]);
});

test("duplicates (same game, region and target) collapse to one, the website's", () => {
  const local = [makeAlert(game(1, 999), 499, "US", T0)];
  const merged = Core.mergeWebAlerts(local, [webAlert(1, 499, 999, T0 + 5)]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].origin, "web");
  // A different target for the same game is a different alert.
  assert.equal(Core.mergeWebAlerts(local, [webAlert(1, 399, 999)]).length, 2);
});

test("the merged list is capped at 200", () => {
  const local = Array.from({ length: 150 }, (_, i) => makeAlert(game(i + 1, 999), 499, "US", T0 + i));
  const remote = Array.from({ length: 150 }, (_, i) => webAlert(1000 + i, 499, 999, T0 + 500 + i));
  assert.equal(Core.mergeWebAlerts(local, remote).length, Core.MAX_SHARED_ALERTS);
});

test("the app keeps its own check state for website alerts it already has; deletions on the website win", () => {
  const remote = [webAlert(1, 499, 999), webAlert(2, 499, 999)];
  let local = Core.mergeWebAlerts([], remote);
  local = checkAlerts(local, new Map([[1, 450]]), "US", T0 + 100).alerts; // the app saw a crossing
  const again = Core.mergeWebAlerts(local, [remote[0]]); // website deleted game 2 meanwhile
  assert.deepEqual(again.map((a) => a.appid), [1]);
  assert.equal(again[0].triggeredAt, T0 + 100);
  assert.equal(again[0].armed, false);
});

test("what fired in the app goes back to the website already seen (one notification, no second badge)", () => {
  const remote = [webAlert(1, 499, 999)];
  const local = checkAlerts(Core.mergeWebAlerts([], remote), new Map([[1, 450]]), "US", T0 + 100).alerts;
  assert.equal(local[0].seen, false, "the app's own bell still counts it");
  const out = Core.webAlertsForRelay(local, remote);
  assert.equal(out[0].triggeredCents, 450);
  assert.equal(out[0].seen, true);
});

test("only website alerts go back to the relay, never the app's own", () => {
  const local = [makeAlert(game(1, 999), 499, "US", T0), webAlert(2, 499, 999)];
  assert.deepEqual(Core.webAlertsForRelay(local, []).map((a) => a.appid), [2]);
});

test("website rebase keeps its own alerts and targets, takes the app's check state", () => {
  const fired = { ...webAlert(1, 499, 999), armed: false, triggeredAt: T0 + 100, triggeredCents: 450, lastCents: 450, seen: true };
  const mine = [webAlert(1, 499, 999), webAlert(3, 299, 999, T0 + 50)]; // added game 3 meanwhile
  const out = Core.rebaseWebAlerts(mine, [fired]);
  assert.deepEqual(out.map((a) => a.appid).sort(), [1, 3]);
  const one = out.find((a) => a.appid === 1);
  assert.equal(one.triggeredAt, T0 + 100);
  assert.equal(one.seen, true);
});

test("the same alerts in a different field order (as the relay stores them) count as unchanged", () => {
  const a = webAlert(1, 499, 999);
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.ok(Core.sameAlerts([a], [reordered]));
  assert.ok(!Core.sameAlerts([a], [{ ...a, seen: !a.seen }]));
});

// ----- who checks -----
test("editing a website alert in the app keeps it a website alert", () => {
  const list = upsertAlert([webAlert(1, 499, 999)], makeAlert(game(1, 999), 399, "US", T0 + 1));
  assert.equal(list.length, 1);
  assert.equal(list[0].origin, "web");
  assert.equal(list[0].targetCents, 399);
});

test("the website leaves checking to a paired app that can do it, and only then", () => {
  assert.equal(alertsCheckedByPc(null), false);
  assert.equal(alertsCheckedByPc({ paired: false, pcVersion: "1.10.0" }), false, "unpaired: as before");
  assert.equal(alertsCheckedByPc({ paired: true, pcVersion: "1.10.0" }), true);
  assert.equal(alertsCheckedByPc({ paired: true, pcVersion: "1.11.2" }), true);
  assert.equal(alertsCheckedByPc({ paired: true, pcVersion: "1.9.1" }), false, "an older app doesn't check them");
  assert.equal(alertsCheckedByPc({ paired: true, pcVersion: null }), true, "unknown yet: wait rather than notify twice");
});

// ----- the desktop engine against a fake relay -----
function fakeRelay() {
  const r = { rev: 0, arev: 0, alerts: [], sets: 0 };
  r.api = async (action, body) => {
    if (action === "sig") return { rev: r.rev, arev: r.arev, active: false, pc: 0 };
    if (action === "basket.get") return { rev: r.rev, items: [] };
    if (action === "cart.set") return { ok: true };
    if (action === "alerts.get") return { rev: r.arev, alerts: structuredClone(r.alerts) };
    if (action === "alerts.set") {
      if (body.rev !== r.arev) return { rev: r.arev, alerts: structuredClone(r.alerts), applied: false };
      r.alerts = structuredClone(body.alerts);
      r.arev += 1;
      r.sets += 1;
      return { rev: r.arev, alerts: structuredClone(r.alerts), applied: true };
    }
    throw new Error(`unexpected ${action}`);
  };
  /** The website writes (as web/src/browser-api/pairing.js does). */
  r.webSet = (alerts) => {
    r.alerts = structuredClone(Core.tagWebAlerts(alerts));
    r.arev += 1;
  };
  return r;
}

function desktop(relay, local = []) {
  const data = { basket: [], mirror: {}, account: null, pairAutoCart: false, pairId: "a".repeat(32), alerts: local, alertsRev: 0 };
  const sent = [];
  const sync = createSync({
    settings: { get: () => data, update: (p) => Object.assign(data, p) },
    steam: {},
    cartSession: async () => ({}),
    sessionFetch: null,
    pairApi: relay.api,
    sendToUI: (channel, payload) => sent.push({ channel, payload }),
    version: "1.10.0",
    shouldNotify: () => false,
  });
  return { data, sent, sync };
}

const until = async (cond, ms = 2000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

test("paired app: picks up website alerts, fires one, and the relay learns it fired (seen)", async () => {
  const relay = fakeRelay();
  relay.webSet([makeAlert(game(10, 1999), 999, "US", T0)]);
  const own = makeAlert(game(20, 999), 499, "US", T0 - 1);
  const pc = desktop(relay, [own]);
  try {
    await pc.sync.afterPaired();
    await until(() => pc.data.alertsRev === relay.arev && pc.data.alerts.length === 2);
    assert.ok(pc.sent.some((m) => m.channel === "settings:changed" && m.payload.alerts.length === 2), "the interface is told");
    assert.equal(relay.sets, 0, "nothing to write back yet; the app's own alert stays local");

    // The interface checks prices (logic/alerts.js) and saves; the engine writes back.
    const { alerts, triggered } = checkAlerts(pc.data.alerts, new Map([[10, 899]]), "US", T0 + 100);
    assert.equal(triggered.length, 1);
    pc.data.alerts = alerts;
    pc.sync.onLocalAlertsChange();
    await until(() => relay.sets === 1);
    assert.equal(relay.alerts.length, 1, "only the website's alert is on the relay");
    assert.deepEqual([relay.alerts[0].triggeredCents, relay.alerts[0].armed, relay.alerts[0].seen], [899, false, true]);
    assert.equal(pc.data.alertsRev, relay.arev, "its own write doesn't make it pull again");
  } finally {
    pc.sync.stop();
  }
});

test("paired app: a website change racing the app's write is merged, not lost", async () => {
  const relay = fakeRelay();
  relay.webSet([makeAlert(game(10, 1999), 999, "US", T0)]);
  const pc = desktop(relay);
  try {
    await pc.sync.afterPaired();
    await until(() => pc.data.alerts.length === 1 && pc.data.alertsRev === relay.arev);
    // The website adds an alert; before the app has pulled it, the app fires the first one.
    relay.webSet([...relay.alerts, makeAlert(game(30, 1999), 999, "US", T0 + 2)]);
    pc.data.alerts = checkAlerts(pc.data.alerts, new Map([[10, 899]]), "US", T0 + 100).alerts;
    pc.sync.onLocalAlertsChange();
    await until(() => relay.alerts.length === 2 && relay.alerts.some((a) => a.triggeredAt));
    assert.deepEqual(relay.alerts.map((a) => a.appid).sort(), [10, 30]);
    assert.equal(relay.alerts.find((a) => a.appid === 10).triggeredCents, 899);
    assert.deepEqual(pc.data.alerts.map((a) => a.appid).sort(), [10, 30], "and the app has the new one");
  } finally {
    pc.sync.stop();
  }
});

test("unpaired app: alert changes never touch the relay", async () => {
  const relay = fakeRelay();
  const pc = desktop(relay, []);
  pc.data.pairId = null;
  try {
    pc.data.alerts = [makeAlert(game(1, 999), 499, "US", T0)];
    pc.sync.onLocalAlertsChange();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(relay.sets, 0);
  } finally {
    pc.sync.stop();
  }
});

// ----- when the pairing ends -----
test("unpaired from the PC: the app drops the website's alerts and keeps its own", async () => {
  const relay = fakeRelay();
  relay.webSet([makeAlert(game(10, 1999), 999, "US", T0)]);
  const own = makeAlert(game(20, 999), 499, "US", T0 - 1);
  const pc = desktop(relay, [own]);
  try {
    await pc.sync.afterPaired();
    await until(() => pc.data.alerts.length === 2);
    pc.data.pairId = null;
    pc.sync.afterUnpaired();
    assert.deepEqual(pc.data.alerts.map((a) => a.appid), [20]);
    assert.deepEqual(pc.sent.at(-1), { channel: "settings:changed", payload: { alerts: [own] } });
  } finally {
    pc.sync.stop();
  }
});

test("withoutWebAlerts keeps exactly the app's own alerts", () => {
  const own = makeAlert(game(1, 999), 499, "US", T0);
  assert.deepEqual(Core.withoutWebAlerts([webAlert(2, 499, 999), own]), [own]);
  assert.deepEqual(Core.withoutWebAlerts(undefined), []);
});

test("a save from an interface that hadn't caught up doesn't delete website alerts that just arrived", async () => {
  const relay = fakeRelay();
  relay.webSet([makeAlert(game(10, 1999), 999, "US", T0)]);
  const own = makeAlert(game(20, 999), 499, "US", T0 - 1);
  const pc = desktop(relay, [own]);
  try {
    await pc.sync.afterPaired();
    await until(() => pc.data.alerts.length === 2);
    const stale = [{ ...own, lastCents: 950 }]; // the interface's list from before the website alert arrived
    const kept = pc.sync.guardAlerts(stale);
    assert.deepEqual(kept.map((a) => a.appid).sort(), [10, 20]);
    assert.equal(kept.find((a) => a.appid === 20).lastCents, 950, "the interface's own change still lands");
  } finally {
    pc.sync.stop();
  }
});
