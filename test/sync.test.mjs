// The desktop's cart-sync engine, against a fake Steam cart. These are the rules people rely on:
// add what's in the basket, remove only what the app added, never fight a purchase or a manual removal.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const createSync = require("../src/main/sync.js");

const OLD = Date.now() - 10 * 60 * 1000; // older than the "just added" grace period
const game = (appid, packageid) => ({ appid, packageid, name: `Game ${appid}`, price: "$1.00", priceCents: 100, originalCents: 1000, discount: 90 });

/** A world with a fake Steam cart and fake settings. */
function world({ basket = [], mirror = {}, cart = [], owned = [], account = { method: "steam", steamid: "76561190000000000" }, autoCart = true, failAdd = null } = {}) {
  const data = { basket, mirror, account, pairAutoCart: autoCart, pairId: null };
  let lineSeq = 100;
  const steamCart = cart.map((pkg) => ({ packageid: pkg, lineItemId: String(lineSeq++) }));
  const calls = { add: [], remove: [] };
  const steam = {
    getCart: async () => ({ items: steamCart.slice(), subtotal: `$${steamCart.length}.00` }),
    addToCart: async (_t, pkgs) => {
      if (failAdd) throw Object.assign(new Error(failAdd), { code: failAdd });
      calls.add.push(...pkgs);
      for (const p of pkgs) steamCart.push({ packageid: p, lineItemId: String(lineSeq++) });
      return { items: steamCart.slice(), subtotal: "$x" };
    },
    removeFromCart: async (_t, ids) => {
      calls.remove.push(...ids);
      for (const id of ids) steamCart.splice(steamCart.findIndex((l) => l.lineItemId === id), 1);
      return { items: steamCart.slice(), subtotal: "$y" };
    },
    fetchUserData: async () => ({ signedIn: true, owned }),
  };
  const settings = {
    get: () => data,
    update: (patch) => Object.assign(data, patch),
  };
  const sent = [];
  const sync = createSync({
    settings,
    steam,
    cartSession: async () => ({ token: "t", country: "US" }),
    sessionFetch: null,
    pairApi: async () => ({}),
    sendToUI: (channel, payload) => sent.push({ channel, payload }),
    version: "test",
    shouldNotify: () => false,
  });
  const lastStatus = () => sent.filter((x) => x.channel === "cart:status").pop()?.payload;
  return { data, steamCart, calls, sync, lastStatus };
}

test("adds basket games that aren't in the cart yet, and remembers it added them", async () => {
  const w = world({ basket: [game(10, 1), game(20, 2)] });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.add.sort(), [1, 2]);
  assert.deepEqual(Object.keys(w.data.mirror).sort(), ["10", "20"]);
  assert.equal(w.lastStatus().status[10].s, "added");
});

test("leaves games already in the cart alone", async () => {
  const w = world({ basket: [game(10, 1)], cart: [1] });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.add, []);
  assert.equal(w.lastStatus().status[10].s, "added");
});

test("removes a game from the cart when it leaves the basket, if the app added it", async () => {
  const w = world({ basket: [game(10, 1)] });
  await w.sync.reconcile();
  w.data.basket = [];
  await w.sync.reconcile();
  assert.equal(w.calls.remove.length, 1);
  assert.equal(w.steamCart.length, 0);
  assert.deepEqual(w.data.mirror, {});
});

test("never removes cart items the person added on Steam by hand", async () => {
  const w = world({ basket: [], cart: [99] });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.remove, []);
  assert.equal(w.steamCart.length, 1);
});

test("doesn't re-add a game the person took out of the cart on Steam", async () => {
  const w = world({ basket: [game(10, 1)], mirror: { 10: { packageid: 1, lineItemId: "5", addedAt: OLD } } });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.add, []);
  assert.equal(w.lastStatus().status[10].s, "removed_on_steam");
});

test("drops a game from the basket once it's owned (checked out)", async () => {
  const w = world({ basket: [game(10, 1), game(20, 2)], cart: [2], mirror: { 10: { packageid: 1, lineItemId: "5", addedAt: OLD } }, owned: [10] });
  await w.sync.reconcile();
  assert.deepEqual(w.data.basket.map((g) => g.appid), [20]);
  assert.equal(w.data.mirror[10], undefined);
});

test("trusts a just-added game during the grace period even if the cart lags", async () => {
  const w = world({ basket: [game(10, 1)], mirror: { 10: { packageid: 1, lineItemId: "5", addedAt: Date.now() } } });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.add, []);
  assert.equal(w.lastStatus().status[10].s, "added");
});

test("games without a package can't go in the cart and are reported, not attempted", async () => {
  const w = world({ basket: [game(10, null)] });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.add, []);
  assert.equal(w.lastStatus().status[10].s, "no_package");
});

test("does nothing to the cart when automatic syncing is switched off", async () => {
  const w = world({ basket: [game(10, 1)], autoCart: false });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.add, []);
  assert.deepEqual(w.lastStatus().status, {});
});

test("asks for a Steam sign-in instead of touching the cart for guests", async () => {
  const w = world({ basket: [game(10, 1)], account: { method: "guest" } });
  await w.sync.reconcile();
  assert.deepEqual(w.calls.add, []);
  assert.equal(w.lastStatus().status[10].s, "needs_steam");
});

test("an expired session is reported per game, not as a crash", async () => {
  const w = world({ basket: [game(10, 1)], failAdd: "session_expired" });
  await w.sync.reconcile();
  assert.equal(w.lastStatus().status[10].s, "needs_steam");
});
