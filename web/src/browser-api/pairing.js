// The shared basket: pairing this browser with the Steam Deals Windows app.
//
// A browser can't touch a Steam cart (browsers block that on purpose). The Windows app can, so once this
// browser is paired the basket lives on the relay (/api/pair) as one document shared by every paired
// device, and the PC keeps the real Steam cart matching it. This browser polls a tiny signal record every
// few seconds while the page is visible, pulls the basket when its revision changes, and pushes its own
// edits as add/remove operations. Nothing here is a purchase; checkout always happens in Steam.
import { isPhone } from "./device.js";
import { emit } from "./events.js";
import { ApiError, http } from "./http.js";
import { saveSettings, settings } from "./settings.js";
import { store } from "./store.js";

const Core = window.SteamCore;
const PAIR_KEY = "sd:pair";
const REV_KEY = "sd:pairrev";
const POLL_MS = 4000;
const TOUCH_MS = 45000; // "someone is looking": the PC polls faster while this is fresh
const PC_ONLINE_MS = 90000;

export const pairId = () => store.get(PAIR_KEY);

let syncTimer = null;
let syncBusy = false;
let lastTouch = 0;
let lastRevSeen = Number(store.get(REV_KEY, 0)) || 0;
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

export function forgetPair() {
  store.del(PAIR_KEY);
  store.del(REV_KEY);
  lastRevSeen = 0;
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
  const mine = settings.basket || [];
  const b = mine.length
    ? await relay({ action: "basket.ops", pairId: r.pairId, ops: mine.map((item) => ({ op: "add", item })), by: isPhone() ? "phone" : "web" })
    : await relay({ action: "basket.get", pairId: r.pairId });
  adopt(b.items, b.rev, "merge");
  startSync();
  return { pairId: r.pairId };
}

/** "Check now": also tells the PC someone is looking, so it switches to fast checks. */
export async function syncNow() {
  lastTouch = 0;
  await syncTick(true);
}

/** Forget the pairing in this browser only, and tell the UI. */
export function unpair() {
  forgetPair();
  emit("cart:status", syncStatus());
}
