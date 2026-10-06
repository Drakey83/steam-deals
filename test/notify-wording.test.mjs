// Messages about basket changes made on another device name that device correctly (a browser is not a phone).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const Core = require("../src/shared/core.js");
const createSync = require("../src/main/sync/index.js");

test("each kind of device gets its own wording, and unknown sources stay general", () => {
  assert.equal(Core.deviceWhere("phone"), "on your phone");
  assert.equal(Core.deviceWhere("web"), "in a browser");
  assert.equal(Core.deviceWhere("pc"), "on your PC");
  assert.equal(Core.deviceWhere(undefined), "on another device");
  assert.equal(Core.deviceWhere("tablet"), "on another device");
});

/** A paired app whose relay basket was just changed on device `by`, with a fake Steam cart. */
function pairedApp(by) {
  const game = { appid: 10, packageid: 1, name: "Game 10", price: "$1.00", priceCents: 100 };
  const data = { basket: [], mirror: {}, account: { method: "steam", steamid: "76561190000000000" }, pairAutoCart: true, pairId: "d".repeat(32), basketRev: 0, alertsRev: 0, prefsRev: 0, alerts: [] };
  const cart = [];
  const shown = [];
  const relay = async (action) => {
    if (action === "sig") return { rev: 1, arev: 0, prev: 0, active: false };
    if (action === "basket.get") return { rev: 1, items: [game], by };
    if (action === "cart.set") return { ok: true };
    throw new Error(`unexpected ${action}`);
  };
  const steam = {
    getCart: async () => ({ items: cart.slice(), subtotal: "$0" }),
    addToCart: async (_t, pkgs) => {
      for (const p of pkgs) cart.push({ packageid: p, lineItemId: `L${p}` });
      return { items: cart.slice(), subtotal: "$1.00" };
    },
    removeFromCart: async () => ({ items: cart.slice(), subtotal: "$0" }),
    fetchUserData: async () => ({ signedIn: true, owned: [] }),
  };
  const sync = createSync({
    settings: { get: () => data, update: (p) => Object.assign(data, p) },
    steam, cartSession: async () => ({ token: "t", country: "US" }), sessionFetch: null, pairApi: relay,
    sendToUI: () => {}, version: "test", shouldNotify: () => true,
    showNotification: (body) => shown.push(body),
  });
  return { sync, shown, cart };
}
const until = async (cond, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 5)); } };

for (const [by, where] of [["web", "in a browser"], ["phone", "on your phone"], [null, "on another device"]]) {
  test(`a game added ${where} is announced as added ${where}`, async () => {
    const app = pairedApp(by);
    try {
      app.sync.syncNow();
      await until(() => app.shown.length > 0);
      assert.equal(app.cart.length, 1, "it went into the Steam cart");
      assert.equal(app.shown[0], `1 game added ${where} is now in your Steam cart`);
    } finally {
      app.sync.stop();
    }
  });
}
