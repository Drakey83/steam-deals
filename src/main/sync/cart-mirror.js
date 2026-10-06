// Keeping the person's real Steam cart in step with the basket, and reporting what's in it.
//
//   basket --> Steam cart: add what's new, take out what left the basket (only games this app put there), never
//              fight a purchase or a removal made on Steam, and drop games from the basket once they're owned.
//   Steam cart --> relay and interface: per-game status ("in your Steam cart", "needs Steam sign-in"…).
//
// Steam is only asked when something changed or on a slow heartbeat (see index.js).

const { deviceWhere } = require("../../shared/core.js");

const ADD_GRACE_MS = 90000; // a game we just added may take a moment to show in GetCart
const REPORT_REPEAT_MS = 10 * 60000; // resend an unchanged cart report at most this often

module.exports = function createCartMirror({ settings, steam, cartSession, sessionFetch, pairApi, sendToUI, version, notify, log, paused, onError }) {
  let reconciling = false;
  let reconcileAgain = false;
  let lastReconcile = 0;
  let lastReport = ""; // JSON of the last cart status sent to the relay
  let lastReportAt = 0;
  let cartStatus = { status: {}, subtotal: null, at: 0 };
  let pendingSource = null; // who caused the next reconcile's additions: "remote" | "local"
  let pendingBy = null; // for "remote": which kind of device ("phone" | "web" | "pc")

  const mirroring = () => settings.get().pairAutoCart !== false;
  const signedIn = () => settings.get().account?.method === "steam";

  /** Make the Steam cart match the basket, then tell the relay (and the interface) what is in the cart. */
  async function reconcile() {
    if (reconciling) {
      reconcileAgain = true;
      return;
    }
    reconciling = true;
    try {
      do {
        reconcileAgain = false;
        await reconcileOnce();
      } while (reconcileAgain);
    } finally {
      reconciling = false;
    }
  }

  async function reconcileOnce() {
    lastReconcile = Date.now();
    const s = settings.get();
    const basket = Array.isArray(s.basket) ? s.basket : [];
    const source = pendingSource;
    const by = pendingBy;
    pendingSource = null;
    pendingBy = null;
    if (!mirroring()) return report({ status: {}, subtotal: null, count: basket.length }, false);
    if (!basket.length && !Object.keys(s.mirror || {}).length) return report({ status: {}, subtotal: null, count: 0 }, true);
    if (!signedIn()) {
      const status = Object.fromEntries(basket.map((i) => [i.appid, { s: "needs_steam" }]));
      if (basket.length) notify("needs_steam", "Sign in through Steam in Steam Deals to keep your Steam cart in sync.");
      return report({ status, subtotal: null, count: basket.length }, false);
    }
    let session;
    try {
      session = await cartSession();
    } catch (err) {
      const status = Object.fromEntries(basket.map((i) => [i.appid, { s: "needs_steam", msg: err.message }]));
      if (basket.length) notify("needs_steam", "Your Steam session expired. Sign in again in Steam Deals to keep your cart in sync.");
      return report({ status, subtotal: null, count: basket.length }, false);
    }
    const { token, country } = session;
    let cart;
    try {
      cart = await steam.getCart(token, country);
    } catch (err) {
      onError(err);
      return; // Steam hiccup: keep the last report, try again next time
    }
    const inCart = new Map(cart.items.filter((li) => li.packageid).map((li) => [li.packageid, li.lineItemId]));
    const mirror = { ...(s.mirror || {}) };
    const status = {};
    const toAdd = [];
    let ownedSet = null;
    const now = Date.now();

    for (const item of basket) {
      const m = mirror[item.appid];
      if (!item.packageid) {
        status[item.appid] = { s: "no_package" };
        continue;
      }
      if (inCart.has(item.packageid)) {
        status[item.appid] = { s: "added" };
        mirror[item.appid] = { packageid: item.packageid, lineItemId: inCart.get(item.packageid), addedAt: m?.addedAt || now };
        continue;
      }
      if (m && m.packageid === item.packageid) {
        if (now - (m.addedAt || 0) < ADD_GRACE_MS) {
          status[item.appid] = { s: "added" }; // just added; GetCart may lag a moment
          continue;
        }
        // We put it in the cart earlier and it is gone: bought, or taken out on Steam. Either way we don't
        // fight the person by re-adding it. If they now own it, drop it from the basket too.
        if (!ownedSet) {
          try {
            const ud = await steam.fetchUserData({ fetchImpl: sessionFetch, steamid: s.account.steamid });
            ownedSet = new Set(ud.signedIn ? ud.owned : []);
          } catch {
            ownedSet = new Set();
          }
        }
        if (ownedSet.has(item.appid)) {
          status[item.appid] = { s: "owned" };
          delete mirror[item.appid];
          continue;
        }
        status[item.appid] = { s: "removed_on_steam" };
        continue;
      }
      toAdd.push(item);
    }

    // Games that left the basket: take them out of the Steam cart, but only the ones we put there.
    const basketIds = new Set(basket.map((i) => i.appid));
    const removals = [];
    for (const [appidStr, m] of Object.entries(mirror)) {
      const appid = Number(appidStr);
      if (basketIds.has(appid)) continue;
      const lineItemId = inCart.get(m.packageid) || m.lineItemId;
      if (inCart.has(m.packageid) && lineItemId) removals.push({ appid, lineItemId });
      delete mirror[appid];
    }
    let removed = 0;
    if (removals.length) {
      try {
        cart = await steam.removeFromCart(token, removals.map((r) => r.lineItemId), country);
        removed = removals.length;
        log(`[sync] removed ${removed} from the Steam cart`);
      } catch (err) {
        onError(err);
      }
    }

    let added = 0;
    if (toAdd.length) {
      try {
        const res = await steam.addToCart(token, toAdd.map((i) => i.packageid), country);
        cart = res;
        const byPkg = new Map(res.items.filter((li) => li.packageid).map((li) => [li.packageid, li.lineItemId]));
        for (const item of toAdd) {
          if (byPkg.has(item.packageid)) {
            status[item.appid] = { s: "added" };
            mirror[item.appid] = { packageid: item.packageid, lineItemId: byPkg.get(item.packageid), addedAt: now };
            added++;
          } else {
            status[item.appid] = { s: "failed", msg: "Steam didn't accept this one." };
          }
        }
        log(`[sync] added ${added} to the Steam cart`);
      } catch (err) {
        onError(err);
        const expired = err.code === "session_expired";
        for (const item of toAdd) status[item.appid] = { s: expired ? "needs_steam" : "failed", msg: err.message };
        if (expired) notify("needs_steam", "Your Steam session expired. Sign in again in Steam Deals to keep your cart in sync.");
        else notify("cart_failed", `Couldn't add to your Steam cart: ${err.message}`, { every: 10 * 60000 });
      }
    }

    // Drop games the person now owns (checked out) from the shared basket.
    const owned = basket.filter((i) => status[i.appid]?.s === "owned");
    if (owned.length) {
      const next = basket.filter((i) => !owned.some((o) => o.appid === i.appid));
      settings.update({ basket: next, mirror });
      sendToUI("basket:replaced", { items: next, source: "owned" });
      if (s.pairId) {
        pairApi("basket.ops", { pairId: s.pairId, ops: owned.map((i) => ({ op: "remove", appid: i.appid })), by: "pc" })
          .then((r) => {
            if (Array.isArray(r?.items)) settings.update({ basket: r.items, basketRev: r.rev || 0 });
          })
          .catch(() => {});
      }
      for (const i of owned) delete status[i.appid];
    } else {
      settings.update({ mirror });
    }

    const games = (n) => `${n} game${n === 1 ? "" : "s"}`;
    if (added && source === "remote") notify("added", `${games(added)} added ${deviceWhere(by)} ${added === 1 ? "is" : "are"} now in your Steam cart`, { every: 0 });
    if (removed && source === "remote") notify("removed", `${games(removed)} removed ${deviceWhere(by)} ${removed === 1 ? "was" : "were"} taken out of your Steam cart`, { every: 0 });

    await report({ status, subtotal: cart?.subtotal ?? null, count: basket.length - owned.length }, true);
  }

  async function report(next, ok) {
    cartStatus = { ...next, at: Date.now(), ok };
    sendToUI("cart:status", cartStatus);
    const s = settings.get();
    if (!s.pairId || paused()) return;
    const key = JSON.stringify([next.status, next.subtotal, ok]);
    const now = Date.now();
    if (key === lastReport && now - lastReportAt < REPORT_REPEAT_MS) return;
    try {
      await pairApi("cart.set", { pairId: s.pairId, cart: next, ok, v: version });
      lastReport = key;
      lastReportAt = now;
    } catch (err) {
      onError(err);
    }
  }

  return {
    reconcile,
    mirroring,
    signedIn,
    status: () => cartStatus,
    lastReconcile: () => lastReconcile,
    /** Check the cart at the next opportunity. */
    due() {
      lastReconcile = 0;
    },
    /** The next changes came from another device ("remote", made on `by`) or from here ("local"), for the notification text. */
    setSource(source, by = null) {
      pendingSource = source;
      pendingBy = by;
    },
    /** A new or ended pairing: send the next cart report even if it looks unchanged. */
    resetReport() {
      lastReport = "";
    },
  };
};
