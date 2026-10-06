// Steam Deals UI entry point (shared by the desktop app and the website).
// No network access here: everything goes through window.steamDeals (lib/platform.js).
//
// Layout of this folder:
//   lib/     DOM helpers, icons, formatting, the event hub, platform access
//   logic/   pure ranking / taste / basket maths (no DOM; unit-tested in /test)
//   ui/      shared widgets: toasts, progress bar, drawer/modal/menu, small bits
//   views/   the screens and panels
//   state.js the shared state;  data.js loading from Steam;  router.js sign-in ↔ browse
import { SCAN_DEPTHS } from "./config.js";
import { $ } from "./lib/dom.js";
import { EV, on } from "./lib/events.js";
import { NARROW, PHONE, api } from "./lib/platform.js";
import { state } from "./state.js";
import { loadAll, onDealsPartial, onTasteProgress, reload } from "./data.js";
import { registerScreen } from "./router.js";
import { closeDrawer, closeMenu, closeModal, isDrawerOpen, isModalOpen } from "./ui/overlays.js";
import { setProgress } from "./ui/progress.js";
import { toast } from "./ui/toast.js";
import { initTooltips } from "./ui/tooltip.js";
import { RECHECK_MS, receiveAlerts, runAlertCheck } from "./alerts.js";
import { initAlerts, scheduleAlertChecks } from "./views/alerts.js";
import { ensureTaxRegion, initBasket } from "./views/basket.js";
import { onBasketReplaced, onCartStatus, receiveBasket } from "./views/cart.js";
import { paintHistory, renderBanners, renderForYouHead, renderGrid, renderStats, updateResults } from "./views/feed.js";
import { renderLogin } from "./views/login.js";
import { placeViewbar, renderBrowse, renderSeg, renderSortSelect, renderUpdated } from "./views/shell.js";
import { renderSidebar, renderTags } from "./views/sidebar.js";

/** What redraws when something changes (see EV in lib/events.js). */
function wireEvents() {
  on(EV.resultsStale, updateResults);
  on(EV.refetch, reload);
  on(EV.loadStarted, () => {
    renderStats();
    renderGrid(true);
    renderForYouHead();
  });
  on(EV.loadFinished, () => {
    renderSidebar(); // library state affects the toggles; deals affect the tag list
    renderSeg();
    renderSortSelect();
    renderBanners();
    updateResults();
    renderUpdated();
    runAlertCheck(); // every catalog scan checks the price alerts
  });
  on(EV.tagsLoaded, () => {
    renderTags();
    if (state.results.length) updateResults(); // relabel cards already on screen
  });
  on(EV.dealsStreamed, () => {
    renderTags();
    updateResults();
  });
  on(EV.libraryChanged, () => {
    renderSidebar();
    renderSeg();
    renderSortSelect();
    renderBanners();
    updateResults();
  });
  on(EV.historyLoaded, paintHistory);
  on(EV.tasteLoading, renderForYouHead);
  on(EV.tasteProgress, renderForYouHead);
  on(EV.modalClosed, renderSidebar); // reflect store/depth changes made in Settings
  initTooltips();
  initBasket();
  initAlerts();
  scheduleAlertChecks(RECHECK_MS);
  NARROW.addEventListener("change", placeViewbar);
  PHONE.addEventListener("change", renderForYouHead);
}

function onKey(e) {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
  if (e.key === "Escape") {
    closeMenu();
    document.body.classList.remove("filters-open");
    if (isModalOpen()) return closeModal();
    if (isDrawerOpen()) return closeDrawer();
    if (typing) document.activeElement.blur();
    return;
  }
  if (e.key === "/" && !typing) {
    const s = $("#search");
    if (s) {
      e.preventDefault();
      s.focus();
      s.select();
    }
  }
  if (e.key === "F5") {
    e.preventDefault();
    if ($("#grid")) loadAll({ force: true });
  }
}

/** Narrow screens: the filters sheet closes on a tap anywhere outside it. */
function closeFiltersOnOutsideTap(e) {
  if (!document.body.classList.contains("filters-open")) return;
  if (e.target.closest("#sidebar") || e.target.closest(".filters-btn")) return;
  document.body.classList.remove("filters-open");
}

function startupNotices() {
  const f = api.features || {};
  if (f.justSignedIn) toast(`Welcome, ${f.justSignedIn}`, { type: "ok" });
  if (f.privateProfile) toast("Your Steam profile's Game details are private, so owned games can't be hidden. Set them to Public in Steam, then refresh.", { type: "err", timeout: 12000 });
  if (f.siteKeyInvalid) toast("You're signed in, but this site can't read Steam libraries right now (its Steam connection needs fixing). Deals still work; try again later or use your own API key.", { type: "err", timeout: 14000 });
  if (f.signInError) toast(`Sign-in didn't finish: ${f.signInError}`, { type: "err", timeout: 10000 });
  touchTipsHint();
}

/** Touch screens have no hover: say once, per device, how to see what something does. */
function touchTipsHint() {
  if (!matchMedia("(hover: none)").matches) return;
  try {
    if (localStorage.getItem("sd:touchTipsHint")) return;
    localStorage.setItem("sd:touchTipsHint", "1");
  } catch {
    return; // no storage: better to skip the hint than show it every time
  }
  setTimeout(() => toast("Tip: press and hold a button, badge or tag to see what it does. Tap ? for help.", { timeout: 9000 }), 2500);
}

async function init() {
  if (typeof api.ready === "function") await api.ready(); // website: load config, finish a Steam sign-in redirect
  state.settings = (await api.settings.get()).settings;
  // Older builds offered different scan depths; snap anything unknown to the standard depth.
  if (!SCAN_DEPTHS.some(([v]) => v === Number(state.settings.scanDepth))) {
    state.settings.scanDepth = 10000;
    api.settings.update({ scanDepth: 10000 });
  }
  const st = await api.auth.status();
  state.account = st.ok ? st.account : null;

  registerScreen("login", renderLogin);
  registerScreen("browse", renderBrowse);
  wireEvents();
  api.deals.onProgress(setProgress);
  api.deals.onPartial(onDealsPartial);
  api.taste.onProgress(onTasteProgress);
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", closeFiltersOnOutsideTap);
  setInterval(renderUpdated, 30000);

  if (!state.account) renderLogin();
  else {
    renderBrowse();
    loadAll();
  }
  ensureTaxRegion();

  // Desktop: baskets handed over from the website (steamdeals:// links), now or while running.
  if (api.deeplink) {
    api.deeplink.onBasket((p) => receiveBasket(p?.items));
    api.deeplink.pending().then((p) => {
      if (p?.ok && p.basket) receiveBasket(p.basket.items);
    });
  }
  // The shared basket: changes made on a paired device, and what is in the Steam cart right now.
  if (api.sync) {
    api.sync.onBasket(onBasketReplaced);
    api.sync.onCart(onCartStatus);
    api.sync.status().then((r) => {
      if (!r.ok) return;
      state.sync = api.platform === "web" ? r : { ...r, status: r.cart?.status || {}, subtotal: r.cart?.subtotal ?? null };
    });
  }
  // Settings changed outside the interface: the tray menu (desktop), or price alerts arriving from the paired
  // website or Windows app.
  api.settings.onChanged?.((s) => {
    const { alerts, ...rest } = s || {};
    state.settings = { ...state.settings, ...rest };
    if (Array.isArray(alerts)) receiveAlerts(alerts);
  });
  startupNotices();
}

init().catch((err) => {
  console.error(err);
  toast(`Startup failed: ${err.message}`, { type: "err", timeout: 10000 });
});
