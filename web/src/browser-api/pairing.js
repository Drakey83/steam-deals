// The shared basket: pairing this browser with the Steam Deals Windows app.
//
// A browser can't touch a Steam cart (browsers block that on purpose). The Windows app can, so once this
// browser is paired the basket lives on the relay (/api/pair) as one document shared by every paired
// device, and the PC keeps the real Steam cart matching it. This browser polls a tiny signal record every
// few seconds while the page is visible, pulls the basket when its revision changes, and pushes its own
// edits as add/remove operations. Nothing here is a purchase; checkout always happens in Steam.
//
// Price alerts made here go to the relay too (the whole list, revision "arev"). The Windows app checks them and
// shows the notification, and writes back what fired, which this browser picks up the same way.
import { isPhone } from "./device.js";
import { emit } from "./events.js";
import { ApiError, http } from "./http.js";
import { saveSettings, settings } from "./settings.js";
import { store } from "./store.js";

const Core = window.SteamCore;
const PAIR_KEY = "sd:pair";
const REV_KEY = "sd:pairrev";
const AREV_KEY = "sd:pairarev";
const PREV_KEY = "sd:pairprev"; // revision of the shared "Your taste" edits last merged
const MINE_KEY = "sd:pairmine"; // alerts made in this browser (keys), which it takes back if it alone unpairs
const POLL_MS = 4000;
const TOUCH_MS = 45000; // "someone is looking": the PC polls faster while this is fresh
const PC_ONLINE_MS = 90000;

export const pairId = () => store.get(PAIR_KEY);

let syncTimer = null;
let syncBusy = false;
let lastTouch = 0;
let lastRevSeen = Number(store.get(REV_KEY, 0)) || 0;
let lastArevSeen = Number(store.get(AREV_KEY, 0)) || 0;
let lastPrevSeen = Number(store.get(PREV_KEY, 0)) || 0;
let remoteTaste = null;
let prefsBusy = false;
let alertsBusy = false;
let alertsAgain = false;
const noPc = () => ({ pc: 0, pcok: false, pcv: null, cart: null, at: 0, now: 0 });
let pcState = noPc();

async function relay(body) {
  const r = await http("/api/pair", { method: "POST", body });
  if (r.enabled === false) throw new ApiError("Pairing isn't available on this site right now.", "pair_down");
  return r;
}

/** Make the relay's basket this browser's basket. */
function adopt(items, rev, source) {
  const changed = !Core.sameBasket(items, settings.basket);
  settings.basket = Array.isArray(items) ? items : [];
  saveSettings();
  lastRevSeen = rev || 0;
  store.set(REV_KEY, lastRevSeen);
  if (changed) emit("basket:replaced", { items: settings.basket, source, rev: lastRevSeen });
}

/** Make the relay's alert list this browser's alerts. */
function adoptAlerts(list, rev) {
  const next = Array.isArray(list) ? list : [];
  const changed = !Core.sameAlerts(next, settings.alerts || []);
  settings.alerts = next;
  saveSettings();
  lastArevSeen = rev || 0;
  store.set(AREV_KEY, lastArevSeen);
  if (changed) emit("settings:changed", { alerts: next });
}

async function pullAlerts(id) {
  const r = await relay({ action: "alerts.get", pairId: id });
  adoptAlerts(r.alerts, r.rev);
}

/** Take the relay's "Your taste" edits (newer wins; combined when first paired). */
function adoptPrefs(prefs, rev, { combine = false } = {}) {
  remoteTaste = prefs?.tasteTags || null;
  const merged = Core.mergeTasteTags(settings.tasteTags, remoteTaste, { combine });
  const changed = !Core.sameTasteTags(merged, settings.tasteTags);
  settings.tasteTags = merged;
  saveSettings();
  lastPrevSeen = rev || 0;
  store.set(PREV_KEY, lastPrevSeen);
  if (changed) emit("settings:changed", { tasteTags: merged });
}

async function pullPrefs(id, opts) {
  const r = await relay({ action: "prefs.get", pairId: id });
  adoptPrefs(r.prefs, r.rev, opts);
  await pushPrefs();
}

/** This browser's "Your taste" edits changed: write them to the relay. */
export async function pushPrefs() {
  const id = pairId();
  if (!id || prefsBusy) return;
  prefsBusy = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (remoteTaste && Core.sameTasteTags(settings.tasteTags, remoteTaste)) return;
      const r = await relay({ action: "prefs.set", pairId: id, prefs: { tasteTags: settings.tasteTags || {} }, rev: lastPrevSeen });
      if (r.applied) {
        remoteTaste = r.prefs?.tasteTags || settings.tasteTags;
        lastPrevSeen = r.rev || 0;
        store.set(PREV_KEY, lastPrevSeen);
        return;
      }
      adoptPrefs(r.prefs, r.rev);
    }
  } catch (err) {
    if (err.code === "bad_pair") forgetPair();
  } finally {
    prefsBusy = false;
  }
}

const mineKeys = () => new Set(store.get(MINE_KEY, []) || []);
function addMine(alerts) {
  const mine = mineKeys();
  for (const a of alerts || []) mine.add(Core.alertKey(a));
  store.set(MINE_KEY, [...mine].slice(-400));
}

/** This browser's alerts changed (from `prev`): write them to the relay, merging with the app's newer check state if needed. */
export async function pushAlerts(prev) {
  const id = pairId();
  if (!id) return;
  if (prev) {
    const before = new Set(prev.map(Core.alertKey));
    addMine((settings.alerts || []).filter((a) => !before.has(Core.alertKey(a))));
  }
  if (alertsBusy) {
    alertsAgain = true;
    return;
  }
  alertsBusy = true;
  try {
    do {
      alertsAgain = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const mine = Core.tagWebAlerts(settings.alerts || []);
        const r = await relay({ action: "alerts.set", pairId: id, alerts: mine, rev: lastArevSeen });
        if (r.applied) {
          adoptAlerts(r.alerts, r.rev);
          break;
        }
        // The app wrote first (an alert fired): keep this browser's alerts, take the app's check state.
        settings.alerts = Core.rebaseWebAlerts(settings.alerts || [], r.alerts);
        saveSettings();
        lastArevSeen = r.rev || 0;
        store.set(AREV_KEY, lastArevSeen);
      }
    } while (alertsAgain);
  } catch (err) {
    if (err.code === "bad_pair") forgetPair();
  } finally {
    alertsBusy = false;
  }
}

export function forgetPair() {
  store.del(PAIR_KEY);
  store.del(REV_KEY);
  store.del(AREV_KEY);
  store.del(MINE_KEY);
  store.del(PREV_KEY);
  lastPrevSeen = 0;
  remoteTaste = null;
  lastRevSeen = 0;
  lastArevSeen = 0;
  clearInterval(syncTimer);
  syncTimer = null;
  pcState = noPc();
}

/** What the basket panel shows: is the PC there, and what's in the Steam cart. */
export function syncStatus() {
  const age = pcState.pc ? (pcState.now || Date.now()) - pcState.pc : null;
  return {
    paired: Boolean(pairId()),
    pcOnline: age != null && age < PC_ONLINE_MS,
    pcSeenAgo: age,
    pcok: pcState.pcok,
    pcVersion: pcState.pcv,
    status: pcState.cart?.status || {},
    subtotal: pcState.cart?.subtotal || null,
    cartAt: pcState.cart?.at || 0,
    at: pcState.at,
  };
}

export async function syncTick(force) {
  const id = pairId();
  if (!id || syncBusy) return;
  if (!force && document.visibilityState !== "visible") return;
  syncBusy = true;
  try {
    const now = Date.now();
    const touch = now - lastTouch > TOUCH_MS;
    if (touch) lastTouch = now;
    const sig = await relay({ action: "sig", pairId: id, touch, withCart: true });
    pcState = { pc: sig.pc || 0, pcok: Boolean(sig.pcok), pcv: sig.pcv || null, cart: sig.cart || null, at: Date.now(), now: sig.now || Date.now() };
    emit("cart:status", syncStatus());
    if ((sig.rev || 0) !== lastRevSeen) {
      const b = await relay({ action: "basket.get", pairId: id });
      adopt(b.items, b.rev, "remote");
    }
    if ((sig.arev || 0) !== lastArevSeen && !alertsBusy) await pullAlerts(id);
    if ((sig.prev || 0) !== lastPrevSeen && !prefsBusy) await pullPrefs(id);
  } catch (err) {
    if (err.code === "bad_pair") {
      forgetPair();
      emit("cart:status", syncStatus());
    }
  } finally {
    syncBusy = false;
  }
}

export function startSync() {
  clearInterval(syncTimer);
  if (!pairId()) return;
  // Alerts this browser had before it could share them (paired before alerts synced): share them now.
  const unshared = (settings.alerts || []).filter((a) => a.origin !== "web");
  if (unshared.length) {
    addMine(unshared);
    pushAlerts();
  }
  syncTimer = setInterval(() => syncTick(false), POLL_MS);
  syncTick(true);
}

/** Check right away whenever the page comes back into view. */
export function watchVisibility() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pairId()) {
      lastTouch = 0;
      syncTick(true);
    }
  });
}

/** This browser changed its basket: send the difference to the relay. */
export async function pushBasket(prev, next) {
  const id = pairId();
  if (!id) return;
  const ops = Core.basketOps(prev, next);
  if (ops.length) {
    try {
      const r = await relay({ action: "basket.ops", pairId: id, ops, by: isPhone() ? "phone" : "web" });
      adopt(r.items, r.rev, "merge");
    } catch (err) {
      if (err.code === "bad_pair") forgetPair();
    }
  }
  lastTouch = 0;
  setTimeout(() => syncTick(true), 1500);
}

/** Redeem a six-letter code from the PC. This browser's basket joins the shared one. */
export async function claim(code) {
  const r = await relay({ action: "claim", code });
  store.set(PAIR_KEY, r.pairId);
  addMine(settings.alerts);
  const mine = settings.basket || [];
  const b = mine.length
    ? await relay({ action: "basket.ops", pairId: r.pairId, ops: mine.map((item) => ({ op: "add", item })), by: isPhone() ? "phone" : "web" })
    : await relay({ action: "basket.get", pairId: r.pairId });
  adopt(b.items, b.rev, "merge");
  // This browser's alerts join any already shared by other browsers on the same pairing.
  const shared = await relay({ action: "alerts.get", pairId: r.pairId });
  lastArevSeen = shared.rev || 0;
  settings.alerts = Core.tagWebAlerts([...(settings.alerts || []), ...(shared.alerts || [])]);
  if (settings.alerts.length) await pushAlerts();
  else adoptAlerts(shared.alerts, shared.rev);
  // "Your taste" edits from this browser and the paired devices are combined.
  lastPrevSeen = 0;
  await pullPrefs(r.pairId, { combine: true });
  startSync();
  return { pairId: r.pairId };
}

/** "Check now": also tells the PC someone is looking, so it switches to fast checks. */
export async function syncNow() {
  lastTouch = 0;
  await syncTick(true);
}

/**
 * Forget the pairing in this browser only, and tell the UI. Alerts made here come back here: they leave the
 * shared list (so the app stops checking them) and this browser checks them itself again. Alerts other paired
 * browsers made stay with them.
 */
export async function unpair() {
  const id = pairId();
  const mine = mineKeys();
  if (id && mine.size) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cur = await relay({ action: "alerts.get", pairId: id });
        const rest = (cur.alerts || []).filter((a) => !mine.has(Core.alertKey(a)));
        if (rest.length === (cur.alerts || []).length) break;
        const w = await relay({ action: "alerts.set", pairId: id, alerts: rest, rev: cur.rev || 0 });
        if (w.applied) break;
      } catch {
        break; // the relay is gone or unreachable: nothing left to take back
      }
    }
  }
  const kept = (settings.alerts || []).filter((a) => mine.has(Core.alertKey(a)));
  const changed = kept.length !== (settings.alerts || []).length;
  settings.alerts = kept;
  saveSettings();
  forgetPair();
  if (changed) emit("settings:changed", { alerts: kept });
  emit("cart:status", syncStatus());
}
