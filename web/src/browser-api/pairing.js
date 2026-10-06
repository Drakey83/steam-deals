// This browser's sync channel: what connects it to the Steam Deals Windows app and the person's other devices.
//
// A browser can't touch a Steam cart (browsers block that on purpose). The Windows app can, so once this browser
// is on a channel the basket lives on the relay (/api/pair) as one document every device on it edits, and the PC
// keeps the real Steam cart matching it. The channel also carries price alerts (shared-alerts.js) and "Your
// taste" edits (shared-prefs.js).
//
// Two ways onto a channel:
//   Steam account   signed in through Steam, this browser joins its account's own channel automatically
//                   (linkAccount); every phone, browser and Windows app signed in to that account shares it.
//   Code            otherwise, a six-letter code from the Windows app (claim).
//
// This module owns joining and leaving, the polling, and the shared basket. It polls a tiny signal record every
// few seconds while the page is visible, and fetches a document only when its revision changed. Nothing here is a
// purchase; checkout always happens in Steam.
import { isPhone } from "./device.js";
import { emit } from "./events.js";
import { http } from "./http.js";
import { relay } from "./relay.js";
import { saveSettings, settings } from "./settings.js";
import { alertsStale, forgetAlerts, joinAlerts, pullAlerts, pushAlerts as pushAlertsTo, shareOlderAlerts, takeBackAlerts } from "./shared-alerts.js";
import { forgetPrefs, joinPrefs, prefsStale, pullPrefs, pushPrefs as pushPrefsTo } from "./shared-prefs.js";
import { store } from "./store.js";

const Core = window.SteamCore;
const PAIR_KEY = "sd:pair";
const REV_KEY = "sd:pairrev"; // revision of the shared basket last merged here
const VIA_KEY = "sd:pairvia"; // "account" when this is the Steam account's channel
const POLL_MS = 4000;
const TOUCH_MS = 45000; // "someone is looking": the PC polls faster while this is fresh
const PC_ONLINE_MS = 90000;

export const pairId = () => store.get(PAIR_KEY);
const viaAccount = () => Boolean(pairId()) && store.get(VIA_KEY) === "account";

let syncTimer = null;
let syncBusy = false;
let lastTouch = 0;
let lastRevSeen = Number(store.get(REV_KEY, 0)) || 0;
const noPc = () => ({ pc: 0, pcok: false, pcv: null, cart: null, at: 0, now: 0 });
let pcState = noPc();

// ----- leaving, and what the basket panel shows -----

/** Forget the channel in this browser (its basket, alerts and taste edits stay here). */
export function forgetPair() {
  store.del(PAIR_KEY);
  store.del(REV_KEY);
  store.del(VIA_KEY);
  forgetAlerts();
  forgetPrefs();
  lastRevSeen = 0;
  clearInterval(syncTimer);
  syncTimer = null;
  pcState = noPc();
}

/** A relay call failed. If the relay no longer knows the channel, leave it quietly; the panel shows "not paired". */
function relayFailed(err) {
  if (err?.code !== "bad_pair") return;
  forgetPair();
  emit("cart:status", syncStatus());
}

/** What the basket panel shows: is the PC there, and what's in the Steam cart. */
export function syncStatus() {
  const age = pcState.pc ? (pcState.now || Date.now()) - pcState.pc : null;
  return {
    paired: Boolean(pairId()),
    viaAccount: viaAccount(),
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

// ----- the shared basket -----

/** Make the relay's basket this browser's basket. */
function adoptBasket(items, rev, source, by = null) {
  const changed = !Core.sameBasket(items, settings.basket);
  settings.basket = Array.isArray(items) ? items : [];
  saveSettings();
  lastRevSeen = rev || 0;
  store.set(REV_KEY, lastRevSeen);
  if (changed) emit("basket:replaced", { items: settings.basket, source, rev: lastRevSeen, by });
}

/** This browser changed its basket: send the difference to the relay. */
export async function pushBasket(prev, next) {
  const id = pairId();
  if (!id) return;
  const ops = Core.basketOps(prev, next);
  if (ops.length) {
    try {
      const r = await relay({ action: "basket.ops", pairId: id, ops, by: isPhone() ? "phone" : "web" });
      adoptBasket(r.items, r.rev, "merge");
    } catch (err) {
      relayFailed(err);
    }
  }
  lastTouch = 0;
  setTimeout(() => syncTick(true), 1500);
}

/** This browser's alerts changed (from `prev`): share them. */
export const pushAlerts = (prev) => pairId() && pushAlertsTo(pairId(), prev).catch(relayFailed);

/** This browser's "Your taste" edits changed: share them. */
export const pushPrefs = () => pairId() && pushPrefsTo(pairId()).catch(relayFailed);

// ----- polling -----

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
      adoptBasket(b.items, b.rev, "remote", b.by);
    }
    if (alertsStale(sig)) await pullAlerts(id);
    if (prefsStale(sig)) await pullPrefs(id);
  } catch (err) {
    relayFailed(err);
  } finally {
    syncBusy = false;
  }
}

export function startSync() {
  clearInterval(syncTimer);
  if (!pairId()) return;
  shareOlderAlerts(pairId())?.catch(relayFailed);
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

/** "Check now": also tells the PC someone is looking, so it switches to fast checks. */
export async function syncNow() {
  lastTouch = 0;
  await syncTick(true);
}

// ----- joining -----

/** Start sharing through channel `id`, combining this browser's basket, alerts and taste edits with it. */
async function join(id) {
  store.set(PAIR_KEY, id);
  const mine = settings.basket || [];
  const b = mine.length
    ? await relay({ action: "basket.ops", pairId: id, ops: mine.map((item) => ({ op: "add", item })), by: isPhone() ? "phone" : "web" })
    : await relay({ action: "basket.get", pairId: id });
  adoptBasket(b.items, b.rev, "merge");
  await joinAlerts(id);
  await joinPrefs(id);
  startSync();
  return { pairId: id };
}

/** Redeem a six-letter code from the PC. */
export async function claim(code) {
  const r = await relay({ action: "claim", code });
  return join(r.pairId);
}

/**
 * Signed in through Steam: join the account's own channel. Nothing to type; this browser's basket, alerts and
 * taste edits are combined with what the account's other devices already share. Safe to call on every start.
 */
export async function linkAccount() {
  const r = await http("/api/auth/link");
  if (!r?.pairId) return { linked: false };
  if (pairId() === r.pairId) {
    store.set(VIA_KEY, "account");
    return { linked: true, already: true };
  }
  if (pairId()) forgetPair(); // a code pairing gives way to the account's channel; this browser's data comes along
  await join(r.pairId);
  store.set(VIA_KEY, "account");
  emit("cart:status", syncStatus());
  return { linked: true, already: false };
}

/** Signed out: this browser leaves the account's channel and keeps its basket and alerts here. */
export function unlinkAccount() {
  if (!viaAccount()) return;
  forgetPair();
  emit("cart:status", syncStatus());
}

/** "Unpair this device": leave a code channel, taking back the alerts made here (shared-alerts.js). */
export async function unpair() {
  await takeBackAlerts(pairId());
  forgetPair();
  emit("cart:status", syncStatus());
}
