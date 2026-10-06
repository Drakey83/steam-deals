// Price alerts UI: the bell in the top bar, the alerts panel (fired, watching, from your wishlist), and the
// "Alert me" control in a game's details. The checking itself is in ../alerts.js; the rules in logic/alerts.js.
import { $, el } from "../lib/dom.js";
import { EV, on } from "../lib/events.js";
import { fmtCents, timeAgo } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { Core, api } from "../lib/platform.js";
import { alertFor, alertsCheckedByPc, makeAlert, parseMoney, removeAlert, unseenAlerts, upsertAlert } from "../logic/alerts.js";
import { markAlertsSeen, runAlertCheck, saveAlerts } from "../alerts.js";
import { alertList, state } from "../state.js";
import { closeDrawer, closeModal, isAlertsOpen, showDrawer } from "../ui/overlays.js";
import { toast } from "../ui/toast.js";

const WISHLIST_MAX = 100;

export function initAlerts() {
  on(EV.alertsChanged, () => {
    renderAlertsButton();
    if (isAlertsOpen()) renderPanel();
  });
  api.alerts?.onOpen?.(openAlerts);
}

// ----- the bell (only once there are alerts, so it doesn't crowd the bar) -----
export function alertsButton() {
  return el("button", { class: "btn btn-icon alerts-btn", id: "alerts-btn", title: "Price alerts", "aria-label": "Price alerts", html: ICON.bell, onclick: openAlerts });
}

export function renderAlertsButton() {
  const b = $("#alerts-btn");
  if (!b) return;
  const n = unseenAlerts(alertList()).length;
  b.hidden = !alertList().length;
  b.classList.toggle("has-unseen", n > 0);
  b.innerHTML = ICON.bell;
  if (n) b.append(el("span", { class: "alerts-count num" }, n));
  b.title = n ? `${n} price alert${n === 1 ? "" : "s"} hit your target` : "Price alerts";
}

// ----- adding / editing -----
/** Create or change the alert for game `d` from text the person typed. Returns true when saved. */
function setAlert(d, text) {
  const cents = parseMoney(text);
  if (!cents) {
    toast("Enter a price, like 9.99.", { type: "err" });
    return false;
  }
  const alert = makeAlert(d, cents, state.settings.country);
  saveAlerts(upsertAlert(alertList(), alert));
  const target = fmtCents(cents, d.price);
  toast(alert.armed ? `Alert set: ${d.name} at or below ${target}.` : `Alert set. ${d.name} is already at or below ${target}; you'll hear when it drops there again.`, { type: "ok", timeout: 6000 });
  return true;
}

/** Suggested target: 20% under the current price, rounded down to .99. */
function suggestion(d) {
  if (!Number.isFinite(d.priceCents) || d.priceCents <= 0) return "";
  const cents = Math.max(99, Math.floor((Math.round(d.priceCents * 0.8) + 1) / 100) * 100 - 1); // 7.49 → 5.99
  return (cents / 100).toFixed(2);
}

function targetInput(value, onSubmit) {
  const input = el("input", { class: "input num alert-input", type: "text", inputmode: "decimal", value, placeholder: "9.99", "aria-label": "Alert price" });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSubmit(input.value);
  });
  return input;
}

/** The control in a game's details panel. */
export function alertControl(d) {
  const host = el("div", { class: "alert-control" });
  const render = () => {
    const a = alertFor(alertList(), d.appid);
    if (a && a.country === state.settings.country) {
      host.replaceChildren(
        el("span", { class: "alert-status", html: ICON.bell }, el("span", {}, `Alert at or below ${fmtCents(a.targetCents, a.priceSample || d.price)}`)),
        el("button", { class: "btn btn-sm btn-ghost", onclick: () => { saveAlerts(removeAlert(alertList(), d.appid)); render(); } }, "Remove"),
      );
      return;
    }
    const input = targetInput(suggestion(d), (v) => setAlert(d, v) && render());
    host.replaceChildren(
      el("span", { class: "muted small" }, "Price alert: tell me at or below"),
      input,
      el("button", { class: "btn btn-sm", html: `${ICON.bell}<span>Alert me</span>`, onclick: () => setAlert(d, input.value) && render() }),
    );
  };
  render();
  return host;
}

// ----- the panel -----
export function openAlerts() {
  closeModal();
  renderPanel();
  markAlertsSeen();
}

let wishlistItems = null; // looked up once per session

function renderPanel() {
  const all = alertList().filter((a) => a.country === state.settings.country);
  const fired = all.filter((a) => a.triggeredAt && !a.armed).sort((a, b) => b.triggeredAt - a.triggeredAt);
  const watching = all.filter((a) => !fired.includes(a));
  const otherRegions = alertList().length - all.length;
  showDrawer([
    el("div", { class: "basket-head" },
      el("div", { class: "fy-title", html: ICON.bell }, el("span", {}, "Price alerts")),
      el("div", { class: "spacer" }),
      el("button", { class: "btn btn-icon btn-ghost", "aria-label": "Close", html: ICON.close, onclick: closeDrawer }),
    ),
    el("div", { class: "drawer-body alerts-body" },
      el("div", { class: "muted small" }, "You hear once each time a game drops to your price (it re-arms if the price goes back up). " +
        (api.platform === "web" && alertsCheckedByPc(state.sync)
          ? "Your paired Steam Deals app on Windows checks these and notifies you, even while this page is closed."
          : "Checked after every scan and every few hours while Steam Deals is open.")),
      fired.length ? section("At your price now", fired.map((a) => alertRow(a, true))) : null,
      section("Watching", watching.length ? watching.map((a) => alertRow(a, false)) : [el("div", { class: "muted small" }, "No alerts yet. Open any game and use “Alert me”, or pick from your wishlist below.")]),
      otherRegions ? el("div", { class: "muted small" }, `${otherRegions} alert${otherRegions === 1 ? " is" : "s are"} for another store region and will be checked when you switch back.`) : null,
      wishlistSection(),
    ),
  ], { kind: "alerts" });
}

const section = (title, rows) => el("div", { class: "alerts-section" }, el("div", { class: "section-title" }, title), el("div", { class: "alerts-list" }, rows));

function alertRow(a, fired) {
  const money = (c) => fmtCents(c, a.priceSample);
  const input = targetInput((a.targetCents / 100).toFixed(2), (v) => edit(v));
  const edit = (v) => {
    const cents = parseMoney(v);
    if (!cents) return toast("Enter a price, like 9.99.", { type: "err" });
    if (cents === a.targetCents) return;
    saveAlerts(upsertAlert(alertList(), makeAlert({ appid: a.appid, name: a.name, price: a.priceSample, priceCents: a.lastCents }, cents, a.country)));
  };
  input.addEventListener("change", () => edit(input.value));
  const status = fired
    ? `Hit ${money(a.triggeredCents)} ${timeAgo(a.triggeredAt)}`
    : a.lastCents != null ? `Now ${money(a.lastCents)}${a.armed ? "" : " · at or below already; waits for the next drop"}` : "Waiting for a price";
  // In the Windows app, alerts made on the paired website say so (they're checked here and synced back).
  const fromWeb = a.origin === "web" && api.platform !== "web"
    ? el("span", { class: "alert-origin", title: "Made on the Steam Deals website. This app checks it and notifies you; changes sync back." }, "From the website")
    : null;
  return el("div", { class: `alert-row ${fired ? "fired" : ""}`, dataset: { origin: a.origin || "app" } },
    el("img", { class: "basket-thumb small", src: Core.headerImage(a.appid), alt: "", loading: "lazy" }),
    el("div", { class: "basket-info" },
      el("a", { class: "basket-name link", href: "#", onclick: (e) => { e.preventDefault(); api.openExternal(Core.storeUrl(a.appid)); } }, a.name),
      el("div", { class: "muted small" }, status, fromWeb)),
    el("label", { class: "alert-target" }, el("span", { class: "muted small" }, "at or below"), input),
    el("button", { class: "btn btn-icon btn-ghost", title: "Delete alert", "aria-label": `Delete the alert for ${a.name}`, html: ICON.close, onclick: () => saveAlerts(removeAlert(alertList(), a.appid)) }),
  );
}

/** Wishlist games without an alert, with their current price, each with a quick "Alert me". Signed-in only. */
function wishlistSection() {
  const wish = [...state.library.wishlist];
  if (!state.library.signedIn || !wish.length || !api.items?.lookup) return null;
  const host = el("div", { class: "alerts-section" }, el("div", { class: "section-title" }, "From your wishlist"));
  const fill = () => {
    const alerted = new Set(alertList().map((a) => a.appid));
    const rows = (wishlistItems || []).filter((d) => !alerted.has(d.appid) && Number.isFinite(d.priceCents)).map((d) => {
      const input = targetInput(suggestion(d), (v) => setAlert(d, v));
      return el("div", { class: "alert-row" },
        el("img", { class: "basket-thumb small", src: Core.headerImage(d.appid), alt: "", loading: "lazy" }),
        el("div", { class: "basket-info" }, el("div", { class: "basket-name" }, d.name), el("div", { class: "muted small num" }, d.discount > 0 ? `${d.price} (−${d.discount}%)` : d.price)),
        el("label", { class: "alert-target" }, el("span", { class: "muted small" }, "at or below"), input),
        el("button", { class: "btn btn-sm", onclick: () => setAlert(d, input.value) }, "Alert me"));
    });
    host.replaceChildren(host.firstChild, rows.length ? el("div", { class: "alerts-list" }, rows) : el("div", { class: "muted small" }, "Every wishlist game already has an alert."));
  };
  if (wishlistItems) fill();
  else {
    host.append(el("div", { class: "muted small" }, "Loading your wishlist…"));
    api.items.lookup(wish.slice(0, WISHLIST_MAX)).then((r) => {
      wishlistItems = r.ok ? r.items || [] : [];
      if (isAlertsOpen()) fill();
    });
  }
  return host;
}

/** Recheck every few hours while the app is open (and right after startup's first scan, via app.js). */
export function scheduleAlertChecks(everyMs) {
  setInterval(runAlertCheck, everyMs);
}
