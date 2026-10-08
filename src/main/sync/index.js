// The Windows app's sync engine. Once paired (by a code, or automatically through the Steam account, see
// ../account-sync.js), the basket, price alerts and "Your taste" edits are documents on the relay
// (web/api/pair.js) that every paired device shares. This engine polls the relay and keeps them in step:
//
//   the shared basket   relay <-> this app's basket (here)
//   the Steam cart      this app's basket -> the real Steam cart, and what's in it -> the relay (cart-mirror.js)
//   price alerts        the website's alerts in, what fired back out (shared-alerts.js)
//   preferences         filters, view and sort, Your taste edits, Not interested, behaviour: the same on every
//                       device, both ways (shared-prefs.js; merge rules in src/shared/sharing.js)
//
// Cost model: the relay is a free Redis with a monthly command budget, so the app polls a one-record "signal"
// every 30 s while idle and every 3 s only while a phone is actively looking (the website says so when its
// basket is open) or right after a change. The signal carries a revision per document, so each is fetched only
// when it changed. Steam itself is only asked about the cart when something changed or on a slow heartbeat,
// which also catches purchases made on Steam.

const { sameBasket: sameItems, basketOps: diffOps } = require("../../shared/core.js");
const createCartMirror = require("./cart-mirror.js");
const createSharedAlerts = require("./shared-alerts.js");
const createSharedPrefs = require("./shared-prefs.js");

const FAST_MS = 3000;
const SLOW_MS = 30000;
const ACTIVE_HOLD_MS = 12000; // stay fast this long after the phone was last seen looking
const CHANGE_HOLD_MS = 60000; // and this long after a basket change
const RECONCILE_FAST_MS = 60000; // re-check the Steam cart this often while fast
const RECONCILE_SLOW_MS = 5 * 60000; // and this often while idle (catches purchases / manual removals)
const HEARTBEAT_MS = 5 * 60000; // tell the relay "I'm here" at least this often even when nobody looks

/** Show a Windows notification (required here so the engine can be unit-tested in plain Node). */
function windowsNotification(body, onClick) {
  const { Notification } = require("electron");
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: "Steam Deals", body });
  n.on("click", () => onClick?.());
  n.show();
}

module.exports = function createSync({ settings, steam, cartSession, sessionFetch, pairApi, sendToUI, version, shouldNotify, onNotificationClick, log = () => {}, showNotification = windowsNotification }) {
  let timer = null;
  let polling = false;
  let fastUntil = 0;
  let lastHeartbeat = 0;
  let lastPoll = 0;
  let lastError = null;
  const notified = new Map(); // key -> last time we showed that notification

  const paired = () => Boolean(settings.get().pairId);
  const paused = () => Boolean(settings.get().syncPaused);
  const onError = (err) => {
    lastError = err?.message || String(err);
  };

  function notify(key, body, { every = 60 * 60000 } = {}) {
    const now = Date.now();
    if ((notified.get(key) || 0) > now - every) return;
    notified.set(key, now);
    if (!shouldNotify()) return;
    try {
      showNotification(body, onNotificationClick);
    } catch {
      /* notifications are decoration */
    }
  }

  const deps = { settings, pairApi, sendToUI, log, paused };
  const cart = createCartMirror({ ...deps, steam, cartSession, sessionFetch, version, notify, onError });
  const alerts = createSharedAlerts(deps);
  const prefs = createSharedPrefs(deps);
  const quietly = (what) => (err) => log(`[sync] ${what}: ${err.message}`);

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
        if (Date.now() - cart.lastReconcile() > RECONCILE_SLOW_MS) await cart.reconcile();
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
      const sig = await pairApi("sig", { pairId: s.pairId, pc: heartbeat ? { ok: cart.signedIn() && cart.mirroring(), v: version } : undefined });
      lastPoll = Date.now();
      lastError = null;
      if (heartbeat) lastHeartbeat = lastPoll;
      if (sig.active) fastUntil = Math.max(fastUntil, lastPoll + ACTIVE_HOLD_MS);
      if (alerts.isStale(sig)) await alerts.pull().catch(quietly("alerts"));
      if (prefs.isStale(sig)) await prefs.pull().catch(quietly("preferences"));
      if ((sig.rev || 0) !== (s.basketRev || 0)) {
        await pullBasket();
      } else if (lastPoll - cart.lastReconcile() > (fast ? RECONCILE_FAST_MS : RECONCILE_SLOW_MS)) {
        await cart.reconcile();
      }
    } catch (err) {
      onError(err);
      if (err?.code === "bad_pair") {
        // The relay forgot us (a year idle, or wiped). Drop the pairing quietly; the UI shows "not paired".
        settings.update({ pairId: null, pairVia: null, basketRev: 0, alertsRev: 0, prefsRev: 0, mirror: {} });
        alerts.drop();
        prefs.reset();
        sendToUI("sync:status", status());
      }
    } finally {
      polling = false;
      schedule();
    }
  }

  // ----- the shared basket -----

  /** The relay has a newer basket: make it ours. */
  async function pullBasket() {
    const s = settings.get();
    const r = await pairApi("basket.get", { pairId: s.pairId });
    const items = Array.isArray(r.items) ? r.items : [];
    const changed = !sameItems(s.basket, items);
    settings.update({ basket: items, basketRev: r.rev || 0 });
    fastUntil = Math.max(fastUntil, Date.now() + CHANGE_HOLD_MS);
    if (changed) {
      log(`[sync] basket from relay: ${items.length} item(s), rev ${r.rev}`);
      sendToUI("basket:replaced", { items, source: "remote", rev: r.rev, by: r.by || null });
      cart.setSource("remote", r.by);
    }
    await cart.reconcile();
  }

  /** Our basket changed (the person edited it here, or a steamdeals:// link arrived): tell the relay. */
  async function pushBasket(prev, next) {
    const s = settings.get();
    if (!s.pairId) return;
    const ops = diffOps(prev, next);
    cart.setSource("local");
    if (ops.length) {
      try {
        const r = await pairApi("basket.ops", { pairId: s.pairId, ops, by: "pc" });
        const items = Array.isArray(r.items) ? r.items : next;
        settings.update({ basket: items, basketRev: r.rev || 0 });
        if (!sameItems(items, next)) sendToUI("basket:replaced", { items, source: "merge", rev: r.rev });
      } catch (err) {
        onError(err);
        log(`[sync] push failed: ${lastError}`);
      }
    }
    fastUntil = Math.max(fastUntil, Date.now() + CHANGE_HOLD_MS);
    await cart.reconcile();
    schedule(FAST_MS);
  }

  function status() {
    const s = settings.get();
    return {
      paired: Boolean(s.pairId),
      viaAccount: Boolean(s.pairId) && s.pairVia === "account",
      paused: paused(),
      mirroring: cart.mirroring(),
      fast: Date.now() < fastUntil,
      lastPoll,
      lastError,
      rev: s.basketRev || 0,
      cart: cart.status(),
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
      cart.setSource("local");
      if (!paired()) {
        cart.reconcile().catch(quietly("cart"));
        return;
      }
      pushBasket(prev, next).catch(quietly("basket"));
    },
    /** The interface is saving alerts: keep website alerts it hadn't caught up with yet (shared-alerts.js). */
    guardAlerts: (next) => alerts.guard(next),
    /** settings.alerts changed here (the interface checked prices, or the person edited an alert). */
    onLocalAlertsChange() {
      if (paired() && !paused()) alerts.push().catch(quietly("alerts"));
    },
    /** settings.tasteTags changed here (the person edited Your taste). */
    onLocalPrefsChange() {
      if (paired() && !paused()) prefs.push().catch(quietly("preferences"));
    },
    /** Just paired: our basket, alerts and taste edits join the shared ones (merged with what's already there). */
    async afterPaired() {
      const s = settings.get();
      try {
        const ops = (s.basket || []).map((item) => ({ op: "add", item }));
        const r = ops.length ? await pairApi("basket.ops", { pairId: s.pairId, ops, by: "pc" }) : await pairApi("basket.get", { pairId: s.pairId });
        settings.update({ basket: r.items || [], basketRev: r.rev || 0 });
        sendToUI("basket:replaced", { items: r.items || [], source: "merge", rev: r.rev });
      } catch (err) {
        onError(err);
      }
      alerts.reset();
      alerts.pull().catch(quietly("alerts"));
      prefs.reset();
      prefs.pull({ combine: true }).catch(quietly("preferences"));
      fastUntil = Date.now() + CHANGE_HOLD_MS;
      cart.due();
      schedule(300);
    },
    afterUnpaired() {
      alerts.drop();
      prefs.reset(); // the preferences stay on this device
      cart.resetReport();
      cart.due();
      schedule(300); // keep mirroring this app's own basket
    },
    /** Something that affects mirroring changed (sign-in, the sync switch, pause). */
    kick() {
      cart.due();
      fastUntil = Date.now() + CHANGE_HOLD_MS;
      schedule(300);
    },
    syncNow: () => {
      fastUntil = Date.now() + CHANGE_HOLD_MS;
      cart.due();
      schedule(0);
    },
    /** Make the Steam cart match the basket now (resolves when done). Used by the tests. */
    reconcile: () => cart.reconcile(),
  };
};
