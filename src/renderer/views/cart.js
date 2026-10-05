// The basket's Steam-cart section: live sync status, per-game cart badges, the manual Send/Undo
// (when automatic syncing is off), and reacting to baskets that changed on another device.
import { $, appendKids, el } from "../lib/dom.js";
import { EV, emit } from "../lib/events.js";
import { durationText, fmtInt, plural, timeAgo } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { api, isPhoneDevice, isWeb } from "../lib/platform.js";
import { mergeIncoming } from "../logic/basket.js";
import { basket, patchSettings, state } from "../state.js";
import { openCartButtons } from "../ui/common.js";
import { isBasketOpen } from "../ui/overlays.js";
import { toast } from "../ui/toast.js";
import { signInFromBrowse } from "./account.js";
import { setBasket } from "./basket.js";
import { appPromo, perGameList, unpairHere } from "./web-cart.js";

/** Is a Steam cart being kept in step with this basket right now (by this app, or by the paired PC)? */
function syncActive() {
  if (isWeb) return Boolean(api.pair?.isPaired());
  return state.settings.pairAutoCart !== false && state.account?.method === "steam";
}

const STATUS_LABELS = {
  added: ["In your Steam cart", "ok", ICON.check],
  owned: ["Already owned", "ok", ICON.check],
  failed: ["Steam didn't take it", "err", ICON.warning],
  no_package: ["Not sold on its own", "warn", ICON.warning],
  needs_steam: [isWeb ? "Waiting for Steam sign-in on your PC" : "Sign in through Steam to add it", "warn", ICON.warning],
  removed_on_steam: ["Taken out of the cart on Steam", "warn", ICON.warning],
};

/** Per-game cart state, as reported by whoever talks to Steam (this app, or the paired PC). */
export function cartBadge(appid) {
  if (!syncActive()) return null;
  const st = state.sync?.status?.[appid];
  const waiting = isWeb && !state.sync?.pcOnline ? "Waiting for your PC" : "Adding to your Steam cart…";
  const [label, cls, icon] = st && STATUS_LABELS[st.s] ? STATUS_LABELS[st.s] : [waiting, "wait", ICON.sync];
  return el("span", { class: `cart-badge ${cls}`, title: st?.msg || "", html: icon }, el("span", {}, label));
}

/** One line that says how the sync is doing. Re-rendered in place when a status event arrives. */
function syncLine() {
  const line = el("div", { class: "sync-line muted small", id: "sync-line" });
  const s = state.sync || {};
  const subtotal = s.subtotal ? ` · Steam cart subtotal ${s.subtotal}` : "";
  if (isWeb) {
    if (!s.paired) return line;
    if (!s.at) line.textContent = "Checking in with your PC…";
    else if (s.pcOnline && s.pcok) line.textContent = `Your PC is connected${subtotal}`;
    else if (s.pcOnline) line.textContent = "Your PC's app is running, but it isn't signed in through Steam or syncing is switched off there, so nothing reaches the cart yet.";
    else if (s.pcSeenAgo == null) line.textContent = "Looking for your PC… Open Steam Deals there (it can sit in the tray). It checks in within half a minute.";
    else line.textContent = `Your PC hasn't checked in for ${durationText(s.pcSeenAgo)}. Your basket is saved; it syncs the moment Steam Deals is running there again.`;
    return line;
  }
  if (s.paused) line.textContent = "Syncing with your phone is paused (tray menu). Changes made there wait until you resume.";
  else if (s.lastError) line.textContent = `Last sync problem: ${s.lastError}`;
  else if (s.paired && s.lastPoll) line.textContent = `Shared with your phone · checked ${timeAgo(s.lastPoll)}${subtotal}`;
  else if (s.subtotal) line.textContent = `Steam cart subtotal ${s.subtotal}`;
  return line;
}

/** The "get it into my Steam cart" box under the basket's totals. */
export function sendPanel(t) {
  const ids = t.items.map((b) => b.packageid).filter(Boolean);
  const missing = t.items.length - ids.length;
  const missingNote = missing
    ? el("div", { class: "muted small" }, `${fmtInt(missing)} game${missing === 1 ? " isn't" : "s aren't"} sold as a single package, so Steam's cart can't take ${missing === 1 ? "it" : "them"}. Use ${missing === 1 ? "its" : "their"} Steam page.`)
    : null;
  const box = el("div", { class: "send-box" });
  if (api.cart?.mode === "direct") appendKids(box, desktopPanel(ids, missingNote));
  else if (api.pair?.isPaired()) appendKids(box, pairedWebPanel(t, missingNote));
  else {
    // Website, not paired: each game opens in Steam with its own Add to Cart button, then what the Windows app adds.
    appendKids(box, el("div", { class: "send-title" }, "Add to your Steam cart"), perGameList(t), missingNote);
    box.append(appPromo(t));
  }
  return box;
}

function desktopPanel(ids, missingNote) {
  if (state.account?.method !== "steam") {
    return [
      el("div", { class: "send-title" }, "Ready to buy?"),
      el("div", { class: "muted" }, "Sign in through Steam (account menu, top right) and this app keeps your Steam cart filled with exactly these games. Nothing is purchased until you check out in Steam."),
      el("button", { class: "btn btn-primary", html: `${ICON.login}<span>Sign in through Steam</span>`, onclick: signInFromBrowse }),
    ];
  }
  if (state.settings.pairAutoCart !== false) {
    return [
      el("div", { class: "send-title ok", html: ICON.sync }, el("span", {}, "Synced with your Steam cart")),
      el("div", { class: "muted" }, `Everything in this basket is put into your Steam cart for you, and taken out again if you remove it here${state.sync?.paired ? " or on your phone" : ""}. Nothing is purchased: you review and pay in Steam's own checkout.`),
      syncLine(),
      openCartButtons(true),
      el("div", { class: "btn-row" },
        el("button", { class: "btn btn-ghost btn-sm", html: `${ICON.refresh}<span>Check now</span>`, onclick: () => api.sync?.now() }),
        el("button", { class: "btn btn-ghost btn-sm", onclick: () => setAutoSync(false) }, "Switch to a Send button"),
      ),
      missingNote,
    ];
  }
  // Manual mode: the person switched automatic syncing off.
  if (state.lastSent) {
    const ls = state.lastSent;
    return [
      el("div", { class: "send-title ok", html: ICON.check }, el("span", {}, ls.count ? `Sent ${plural(ls.count, "game")} to your Steam cart` : "Already in your Steam cart")),
      ls.subtotal ? el("div", { class: "muted" }, `Steam's cart subtotal: ${ls.subtotal}. Review and pay on Steam as usual.`) : null,
      openCartButtons(),
      ls.added?.length ? el("button", { class: "btn btn-ghost btn-sm", html: `${ICON.undo}<span>Undo: remove them from my Steam cart</span>`, onclick: undoSend }) : null,
    ];
  }
  const sendBtn = el("button", { class: "btn btn-primary", disabled: !ids.length, html: `${ICON.basket}<span>Send to my Steam cart</span>` });
  sendBtn.addEventListener("click", () => sendDirect(ids, sendBtn));
  return [
    el("div", { class: "send-title" }, "Ready to buy?"),
    el("div", { class: "muted" }, "One click puts these in your Steam cart. Nothing is purchased: you check out in Steam as usual."),
    sendBtn,
    el("button", { class: "btn btn-ghost btn-sm", onclick: () => setAutoSync(true) }, "Sync automatically instead"),
    missingNote,
  ];
}

function setAutoSync(on) {
  patchSettings({ pairAutoCart: on }, { persistNow: true });
  if (on) api.sync?.now();
  emit(EV.basketOpen);
}

function pairedWebPanel(t, missingNote) {
  return [
    el("div", { class: "send-title ok", html: ICON.sync }, el("span", {}, "Synced with your PC's Steam cart")),
    el("div", { class: "muted" }, isPhoneDevice()
      ? "The Steam Deals app on your PC puts everything here into your Steam cart and takes out what you remove. The cart belongs to your account, so you can check out right here in the Steam app, or on the PC."
      : "The Steam Deals app on your PC puts everything here into your Steam cart and takes out what you remove. Check out in Steam whenever you're ready."),
    syncLine(),
    openCartButtons(true),
    missingNote,
    el("details", { class: "shortcut" }, el("summary", {}, "Open each game in Steam instead"), perGameList(t)),
    el("div", { class: "muted small" }, "Paired with your PC. ", el("a", { class: "link", href: "#", onclick: (e) => { e.preventDefault(); unpairHere(); } }, "Unpair this device")),
  ];
}

async function sendDirect(ids, btn) {
  btn.disabled = true;
  btn.innerHTML = `${ICON.basket}<span>Sending…</span>`;
  const r = await api.cart.add({ packageids: ids });
  if (!r.ok) {
    btn.disabled = false;
    btn.innerHTML = `${ICON.basket}<span>Send to my Steam cart</span>`;
    if (r.error.code === "session_expired" || r.error.code === "needs_steam") toast(r.error.message, { type: "err", action: signInFromBrowse, actionLabel: "Sign in", timeout: 8000 });
    else toast(r.error.message, { type: "err", timeout: 7000 });
    return;
  }
  state.lastSent = { count: r.added?.length || ids.length, added: r.added || [], subtotal: r.cart?.subtotal || null };
  toast(`${plural(state.lastSent.count, "game")} added to your Steam cart`, { type: "ok" });
  emit(EV.basketOpen);
}

async function undoSend() {
  const ls = state.lastSent;
  if (!ls?.added?.length) return;
  const r = await api.cart.remove({ lineItemIds: ls.added });
  if (!r.ok) return toast(r.error.message, { type: "err" });
  state.lastSent = null;
  toast("Removed from your Steam cart. Your basket here is unchanged.", { type: "ok" });
  emit(EV.basketOpen);
}

/** The shared basket changed somewhere else (phone, PC, or a merge after pairing). */
export function onBasketReplaced({ items, source } = {}) {
  const before = basket().length;
  state.settings = { ...state.settings, basket: Array.isArray(items) ? items : [] };
  state.lastSent = null;
  emit(EV.basketChanged);
  if (source !== "remote") return;
  const after = basket().length;
  const from = isWeb ? "your PC" : "your phone";
  const msg = after > before ? `${plural(after - before, "game")} added from ${from}`
    : after < before ? `${plural(before - after, "game")} removed from ${from}`
    : `Basket updated from ${from}`;
  toast(msg, { type: "ok", timeout: 4000 });
}

/** Cart status arrived (per-game "in your Steam cart", PC online, and so on): refresh in place. */
export function onCartStatus(st) {
  state.sync = { ...(state.sync || {}), ...(st || {}) };
  if (!isBasketOpen()) return;
  for (const b of basket()) {
    const host = document.querySelector(`[data-cart-badge="${b.appid}"]`);
    if (host) host.replaceChildren(...[cartBadge(b.appid)].filter(Boolean));
  }
  $("#sync-line")?.replaceWith(syncLine());
}

/** Desktop: games handed over from the website through a steamdeals:// link. */
export async function receiveBasket(items) {
  const wanted = (items || []).map((i) => ({ appid: Number(i.appid), packageid: Number(i.packageid) || null })).filter((i) => i.appid > 0);
  if (!wanted.length) return;
  const byApp = new Map(state.deals.map((d) => [d.appid, d]));
  const missing = wanted.filter((i) => !byApp.has(i.appid)).map((i) => i.appid);
  if (missing.length && api.items?.lookup) {
    const r = await api.items.lookup(missing);
    if (r.ok) for (const d of r.items || []) byApp.set(d.appid, d);
  }
  const { list, added } = mergeIncoming(basket(), wanted, byApp);
  setBasket(list);
  if ($("#grid")) emit(EV.basketOpen);
  toast(added ? `${plural(added, "game")} added from the website` : "Those games from the website are already in your basket", { type: "ok", timeout: 5000 });
}
