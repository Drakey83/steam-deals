// Shared-basket sync for the Windows app.
//
// Once the app is paired, the basket is a document on the relay (web/api/pair.js) that every paired
// phone or browser edits too. This module keeps three things in step:
//   1. the relay's basket  <->  this app's basket (settings.basket), both directions;
//   2. this app's basket   -->  the person's real Steam cart (add what's new, remove what they took out);
//   3. the Steam cart's state --> the relay, so the phone can show "in your Steam cart" per game.
// It also brings in the price alerts made on the website (relay "alerts", revision "arev" in the signal) and
// writes back what happened to them. This app checks them with its own alerts and shows the notification
// (the interface does the checking, renderer/alerts.js); the website only shows the result.
//
// Cost model: the relay is a free Redis with a monthly command budget, so the app polls a one-record
// "signal" every 30 s while idle and every 3 s only while a phone is actively looking (the website
// says so when its basket is open) or right after a change. Steam itself is only asked about the cart
// when something changed or on a slow heartbeat, which also catches purchases made on Steam.

const { sameBasket: sameItems, basketOps: diffOps, mergeWebAlerts, webAlertsForRelay, sameAlerts, withoutWebAlerts, alertKey } = require("../shared/core.js");

const FAST_MS = 3000;
const SLOW_MS = 30000;
const ACTIVE_HOLD_MS = 12000; // stay fast this long after the phone was last seen looking
const CHANGE_HOLD_MS = 60000; // and this long after a basket change
const RECONCILE_FAST_MS = 60000; // re-check the Steam cart this often while fast
const RECONCILE_SLOW_MS = 5 * 60000; // and this often while idle (catches purchases / manual removals)
const HEARTBEAT_MS = 5 * 60000; // tell the relay "I'm here" at least this often even when nobody looks
const ADD_GRACE_MS = 90000; // a game we just added may take a moment to show in GetCart
const ADOPT_GRACE_MS = 5000; // an interface save this soon after website alerts arrived may not include them yet

module.exports = function createSync({ settings, steam, cartSession, sessionFetch, pairApi, sendToUI, version, shouldNotify, onNotificationClick, log = () => {} }) {
  let timer = null;
  let polling = false;
  let reconciling = false;
  let reconcileAgain = false;
  let fastUntil = 0;
  let lastHeartbeat = 0;
  let lastReconcile = 0;
  let lastReport = ""; // JSON of the last cart status we sent to the relay
  let lastReportAt = 0;
  let lastPoll = 0;
  let lastError = null;
  const notified = new Map(); // key -> last time we showed that notification
  let cartStatus = { status: {}, subtotal: null, at: 0 };
  let pendingSource = null; // who caused the next reconcile's additions: "remote" | "local"
  let remoteAlerts = null; // the relay's alert list as last read or written (null = not read yet)
  let alertsBusy = false;
  let alertsAgain = false;
  let adopted = { keys: new Set(), at: 0 }; // website alerts that just arrived, and when

  const paired = () => Boolean(settings.get().pairId);
  const mirroring = () => settings.get().pairAutoCart !== false;
  const paused = () => Boolean(settings.get().syncPaused);
  const signedIn = () => settings.get().account?.method === "steam";

  function notify(key, body, { every = 60 * 60000 } = {}) {
    const now = Date.now();
    if ((notified.get(key) || 0) > now - every) return;
    notified.set(key, now);
    if (!shouldNotify()) return;
    try {
      const { Notification } = require("electron"); // required here so the engine can be unit-tested in plain Node
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: "Steam Deals", body });
      n.on("click", () => onNotificationClick?.());
      n.show();
    } catch {
      /* notifications are decoration */
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms ?? (!paired() ? RECONCILE_SLOW_MS : Date.now() < fastUntil ? FAST_MS : SLOW_MS));
  }

  async function tick() {
    if (polling) return schedule();
    if (!paired()) {
      // Not paired: nothing to poll, but this app still keeps its own basket mirrored into the Steam cart.
      polling = true;
      try {
        if (Date.now() - lastReconcile > RECONCILE_SLOW_MS) await reconcile();
      } finally {
        polling = false;
        schedule();
      }
      return;
    }
    if (paused()) return schedule();
    polling = true;
    try {
      const s = settings.get();
      const now = Date.now();
      const fast = now < fastUntil;
      const heartbeat = fast || now - lastHeartbeat > HEARTBEAT_MS;
      const sig = await pairApi("sig", { pairId: s.pairId, pc: heartbeat ? { ok: signedIn() && mirroring(), v: version } : undefined });
      lastPoll = Date.now();
      lastError = null;
      if (heartbeat) lastHeartbeat = lastPoll;
      if (sig.active) fastUntil = Math.max(fastUntil, lastPoll + ACTIVE_HOLD_MS);
      if ((sig.arev || 0) !== (s.alertsRev || 0)) await pullAlerts().catch((err) => log(`[sync] alerts: ${err.message}`));
      if ((sig.rev || 0) !== (s.basketRev || 0)) {
        await pull();
      } else if (lastPoll - lastReconcile > (fast ? RECONCILE_FAST_MS : RECONCILE_SLOW_MS)) {
        await reconcile();
      }
    } catch (err) {
      lastError = err?.message || String(err);
      if (err?.code === "bad_pair") {
        // The relay forgot us (a year idle, or wiped). Drop the pairing quietly; the UI shows "not paired".
        settings.update({ pairId: null, basketRev: 0, alertsRev: 0, mirror: {} });
        dropWebAlerts();
        sendToUI("sync:status", status());
      }
    } finally {
      polling = false;
      schedule();
    }
  }

  /** The relay has a newer basket: make it ours. */
  async function pull() {
    const s = settings.get();
    const r = await pairApi("basket.get", { pairId: s.pairId });
    const items = Array.isArray(r.items) ? r.items : [];
    const changed = !sameItems(s.basket, items);
    settings.update({ basket: items, basketRev: r.rev || 0 });
    fastUntil = Math.max(fastUntil, Date.now() + CHANGE_HOLD_MS);
    if (changed) {
      log(`[sync] basket from relay: ${items.length} item(s), rev ${r.rev}`);
      sendToUI("basket:replaced", { items, source: "remote", rev: r.rev });
      pendingSource = "remote";
    }
    await reconcile();
  }

  /** Our basket changed (the person edited it here, or a steamdeals:// link arrived): tell the relay. */
  async function push(prev, next) {
    const s = settings.get();
    if (!s.pairId) return;
    const ops = diffOps(prev, next);
    pendingSource = "local";
    if (ops.length) {
      try {
        const r = await pairApi("basket.ops", { pairId: s.pairId, ops, by: "pc" });
        const items = Array.isArray(r.items) ? r.items : next;
        settings.update({ basket: items, basketRev: r.rev || 0 });
        if (!sameItems(items, next)) sendToUI("basket:replaced", { items, source: "merge", rev: r.rev });
      } catch (err) {
        lastError = err?.message || String(err);
        log(`[sync] push failed: ${lastError}`);
      }
    }
    fastUntil = Math.max(fastUntil, Date.now() + CHANGE_HOLD_MS);
    await reconcile();
    schedule(FAST_MS);
  }

  // ----- price alerts from the website -----

  /** The pairing ended: alerts made on the website stay there (it checks them itself again), not here. */
  function dropWebAlerts() {
    remoteAlerts = null;
    const s = settings.get();
    const own = withoutWebAlerts(s.alerts);
    if (own.length === (s.alerts || []).length) return;
    settings.update({ alerts: own, alertsRev: 0 });
    sendToUI("settings:changed", { alerts: own });
  }

  /** Fold the relay's alert list (revision `rev`) into this app's alerts and tell the interface. */
  function adoptAlerts(list, rev) {
    const s = settings.get();
    remoteAlerts = Array.isArray(list) ? list : [];
    const merged = mergeWebAlerts(s.alerts, remoteAlerts);
    const changed = !sameAlerts(merged, s.alerts || []);
    const had = new Set((s.alerts || []).map(alertKey));
    adopted = { keys: new Set(merged.filter((a) => !had.has(alertKey(a))).map(alertKey)), at: Date.now() };
    settings.update({ alerts: merged, alertsRev: rev || 0 });
    if (changed) {
      log(`[sync] alerts from the website: ${remoteAlerts.length}`);
      sendToUI("settings:changed", { alerts: merged });
    }
  }

  /** The relay's alerts changed: take them, then send back anything this app knows that the relay doesn't. */
  async function pullAlerts() {
    const r = await pairApi("alerts.get", { pairId: settings.get().pairId });
    adoptAlerts(r.alerts, r.rev);
    await pushAlerts();
  }

  /** Write this app's copies of the web alerts (check state, fired) to the relay, merging if it moved meanwhile. */
  async function pushAlerts() {
    if (alertsBusy) {
      alertsAgain = true;
      return;
    }
    alertsBusy = true;
    try {
      do {
        alertsAgain = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const s = settings.get();
          if (!s.pairId || paused()) return;
          if (!remoteAlerts) {
            const r = await pairApi("alerts.get", { pairId: s.pairId });
            adoptAlerts(r.alerts, r.rev);
            continue;
          }
          const out = webAlertsForRelay(settings.get().alerts, remoteAlerts);
          if (sameAlerts(out, remoteAlerts)) break;
          const r = await pairApi("alerts.set", { pairId: s.pairId, alerts: out, rev: settings.get().alertsRev || 0 });
          if (r.applied) {
            remoteAlerts = r.alerts || out;
            settings.update({ alertsRev: r.rev || 0 });
            break;
          }
          adoptAlerts(r.alerts, r.rev); // the website changed them first: merge, then try again
        }
      } while (alertsAgain);
    } finally {
      alertsBusy = false;
    }
  }

  /** Make the Steam cart match the basket, then tell the relay (and the UI) what is in the cart. */
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
    pendingSource = null;
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
      lastError = err.message;
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
        lastError = err.message;
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
        lastError = err.message;
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

    if (added && source === "remote") notify("added", `${added} game${added === 1 ? "" : "s"} from your phone added to your Steam cart`, { every: 0 });
    if (removed && source === "remote") notify("removed", `${removed} game${removed === 1 ? "" : "s"} removed from your Steam cart`, { every: 0 });

    await report({ status, subtotal: cart?.subtotal ?? null, count: basket.length - owned.length }, true);
  }

  async function report(next, ok) {
    cartStatus = { ...next, at: Date.now(), ok };
    sendToUI("cart:status", cartStatus);
    const s = settings.get();
    if (!s.pairId || paused()) return;
    const key = JSON.stringify([next.status, next.subtotal, ok]);
    const now = Date.now();
    if (key === lastReport && now - lastReportAt < 10 * 60000) return;
    try {
      await pairApi("cart.set", { pairId: s.pairId, cart: next, ok, v: version });
      lastReport = key;
      lastReportAt = now;
    } catch (err) {
      lastError = err.message;
    }
  }

  function status() {
    const s = settings.get();
    return {
      paired: Boolean(s.pairId),
      paused: paused(),
      mirroring: mirroring(),
      fast: Date.now() < fastUntil,
      lastPoll,
      lastError,
      rev: s.basketRev || 0,
      cart: cartStatus,
    };
  }

  return {
    start() {
      fastUntil = Date.now() + CHANGE_HOLD_MS; // check promptly after launch
      schedule(500);
    },
    stop() {
      clearTimeout(timer);
      timer = null;
    },
    status,
    /** settings.basket changed here (UI, steamdeals:// link). */
    onLocalBasketChange(prev, next) {
      pendingSource = "local";
      if (!paired()) {
        reconcile().catch((err) => log(`[sync] ${err.message}`));
        return;
      }
      push(prev, next).catch((err) => log(`[sync] ${err.message}`));
    },
    /**
     * The interface is saving `next` alerts. If website alerts arrived moments ago and the save lacks them, it was
     * made from a list that predates them (the interface hadn't caught up), not a deletion: keep them.
     */
    guardAlerts(next) {
      if (!Array.isArray(next) || Date.now() - adopted.at > ADOPT_GRACE_MS || !adopted.keys.size) return next;
      const have = new Set(next.map(alertKey));
      const lost = (settings.get().alerts || []).filter((a) => adopted.keys.has(alertKey(a)) && !have.has(alertKey(a)));
      return lost.length ? [...lost, ...next] : next;
    },
    /** settings.alerts changed here (the interface checked prices, or the person edited an alert). */
    onLocalAlertsChange() {
      if (!paired() || paused()) return;
      pushAlerts().catch((err) => log(`[sync] alerts: ${err.message}`));
    },
    /** Just paired: our basket becomes the shared one (merged with whatever is already there). */
    async afterPaired() {
      const s = settings.get();
      try {
        const ops = (s.basket || []).map((item) => ({ op: "add", item }));
        const r = ops.length ? await pairApi("basket.ops", { pairId: s.pairId, ops, by: "pc" }) : await pairApi("basket.get", { pairId: s.pairId });
        settings.update({ basket: r.items || [], basketRev: r.rev || 0 });
        sendToUI("basket:replaced", { items: r.items || [], source: "merge", rev: r.rev });
      } catch (err) {
        lastError = err.message;
      }
      remoteAlerts = null;
      pullAlerts().catch((err) => log(`[sync] alerts: ${err.message}`));
      fastUntil = Date.now() + CHANGE_HOLD_MS;
      lastReconcile = 0;
      schedule(300);
    },
    afterUnpaired() {
      dropWebAlerts();
      lastReport = "";
      lastReconcile = 0;
      schedule(300); // keep mirroring this app's own basket
    },
    /** Something that affects mirroring changed (sign-in, the sync switch, pause). */
    kick() {
      lastReconcile = 0;
      fastUntil = Date.now() + CHANGE_HOLD_MS;
      schedule(300);
    },
    syncNow: () => {
      fastUntil = Date.now() + CHANGE_HOLD_MS;
      lastReconcile = 0;
      schedule(0);
    },
    /** Make the Steam cart match the basket now (resolves when done). Used by the tests. */
    reconcile,
  };
};
