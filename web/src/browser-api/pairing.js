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
// few seconds while the page is visible, and fetches a document only when its revision changed. Busy mode: while
// someone is using this page it says so on each poll, and while another device is in use (the relay's `busy`) it
// polls every second, so changes made there show here within about a second. Nothing here is a
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
const TAG_KEY = "sd:devtag"; // this browser's tag in busy mode
// How often to check, from the relay's shared free budget: every second while another device is in use (busy
// mode), every 10 s while this page is being used, every 2 minutes after 5 quiet minutes, and not at all after 30
// (a tab left open all day costs nothing); any click, key, scroll or coming back to the tab checks right away.
const BUSY_POLL_MS = 1000;
const POLL_MS = 10000;
const QUIET_POLL_MS = 2 * 60000;
const QUIET_AFTER_MS = 5 * 60000;
const ASLEEP_AFTER_MS = 30 * 60000;
const OVER_LIMIT_WAIT_MS = 30 * 60000; // the relay's free monthly limit is reached: check only this often
const MAX_RETRY_MS = 5 * 60000; // other relay failures: wait longer after each, up to this
const IN_USE_MS = 25000; // input this recent means "someone is using this page" (the relay holds it 30 s)
const TOUCH_MS = 45000; // "someone is using the site": the PC polls a bit faster (10 s) while this is fresh
const PC_ONLINE_MS = 12 * 60000; // an idle PC says "I'm here" every 10 minutes (src/main/sync/index.js)

export const pairId = () => store.get(PAIR_KEY);
const viaAccount = () => Boolean(pairId()) && store.get(VIA_KEY) === "account";

let syncTimer = null;
let syncBusy = false;
let othersBusy = false; // another device on the channel is in use right now
let lastInput = Date.now(); // opening the page counts as using it
let asleep = false; // stopped checking after a long quiet spell
let failures = 0; // relay failures in a row
let waitUntil = 0; // don't poll the relay before this (backing off after failures)
let overLimit = false;
const inUse = () => Date.now() - lastInput < IN_USE_MS && document.visibilityState === "visible";
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
  clearTimeout(syncTimer);
  syncTimer = null;
  othersBusy = false;
  pcState = noPc();
}

/** A relay call failed. If the relay no longer knows the channel, leave it quietly; the panel shows "not paired". */
function relayFailed(err) {
  if (err?.code !== "bad_pair") {
    // Back off, so a struggling or full relay (and the site it runs on) isn't hammered by every open tab.
    failures += 1;
    const was = overLimit;
    overLimit = err?.code === "over_limit";
    othersBusy = false;
    waitUntil = Date.now() + (overLimit ? OVER_LIMIT_WAIT_MS : Math.min(MAX_RETRY_MS, 10000 * 2 ** (failures - 1)));
    if (overLimit !== was) emit("cart:status", syncStatus());
    return;
  }
  forgetPair();
  emit("cart:status", syncStatus());
}

/** What the basket panel shows: is the PC there, and what's in the Steam cart. */
export function syncStatus() {
  const age = pcState.pc ? (pcState.now || Date.now()) - pcState.pc : null;
  return {
    paired: Boolean(pairId()),
    viaAccount: viaAccount(),
    overLimit,
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
  if (force !== "now" && Date.now() < waitUntil) return; // backing off after relay failures (only "Check now" skips it)
  syncBusy = true;
  try {
    const now = Date.now();
    const touch = now - lastTouch > TOUCH_MS && now - lastInput < QUIET_AFTER_MS;
    if (touch) lastTouch = now;
    const sig = await relay({ action: "sig", pairId: id, touch, withCart: true, me: deviceTag(), busy: inUse() || undefined });
    othersBusy = Boolean(sig.busy);
    failures = 0;
    waitUntil = 0;
    overLimit = false;
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

/** This browser's tag in busy mode (random, kept), so it isn't sped up by its own use. */
function deviceTag() {
  let tag = store.get(TAG_KEY);
  if (!/^[a-z0-9]{8}$/.test(tag || "")) {
    tag = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
    store.set(TAG_KEY, tag);
  }
  return tag;
}

function scheduleTick() {
  clearTimeout(syncTimer);
  if (!pairId()) return;
  const quiet = Date.now() - lastInput;
  asleep = !othersBusy && quiet > ASLEEP_AFTER_MS;
  if (asleep) return; // noteInput / coming back to the tab wakes it
  const normal = othersBusy ? BUSY_POLL_MS : quiet > QUIET_AFTER_MS ? QUIET_POLL_MS : POLL_MS;
  syncTimer = setTimeout(async () => {
    await syncTick(false);
    scheduleTick();
  }, Math.max(normal, waitUntil - Date.now()));
}

export function startSync() {
  if (!pairId()) return;
  shareOlderAlerts(pairId())?.catch(relayFailed);
  syncTick(true);
  scheduleTick();
}

/** Someone started using this page after a pause: tell the other devices now, not at the next poll. */
function noteInput() {
  const idle = !inUse();
  const quiet = Date.now() - lastInput > QUIET_AFTER_MS;
  lastInput = Date.now();
  if (!idle || !pairId()) return;
  if (quiet) lastTouch = 0; // back after a while: the PC should speed up too
  syncTick(true);
  if (quiet || asleep) scheduleTick(); // back to the quick rate now
}

/** Check right away whenever the page comes back into view; notice when someone is using it (busy mode). */
export function watchVisibility() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pairId()) {
      lastTouch = 0;
      lastInput = Date.now(); // coming back to the tab counts as using it
      syncTick(true);
      scheduleTick();
    }
  });
  // Busy mode: any click, tap, key or scroll counts as using this page.
  for (const type of ["pointerdown", "keydown", "wheel", "input"]) document.addEventListener(type, noteInput, { capture: true, passive: true });
}

/** "Check now": also tells the PC someone is looking, so it switches to fast checks. */
export async function syncNow() {
  lastTouch = 0;
  waitUntil = 0;
  await syncTick("now");
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
