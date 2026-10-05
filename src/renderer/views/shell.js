// The browse screen's frame: layout, top bar, the For-you/Browse and On-sale/All-games toggles, sort.
import { SORTS } from "../config.js";
import { $, el } from "../lib/dom.js";
import { timeAgo } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { NARROW, api, isWeb } from "../lib/platform.js";
import { isPersonal, patchSettings, state, syncSortWithView, viewMode } from "../state.js";
import { loadAll } from "../data.js";
import { accountChip } from "./account.js";
import { basketButton, renderBasketButton } from "./basket.js";
import { renderBanners, setupInfiniteScroll, updateResults } from "./feed.js";
import { renderSidebar } from "./sidebar.js";

export function renderBrowse() {
  const app = $("#app");
  app.innerHTML = "";
  const content = el("section", { class: "content" },
    topbar(),
    el("div", { class: "scroller", id: "scroller" },
      el("div", { id: "viewbar-slot" }), // the view/catalog toggles land here on narrow screens so they scroll away
      el("div", { id: "banners" }),
      el("div", { class: "stats", id: "stats" }),
      el("div", { id: "foryou-head" }),
      el("div", { class: "grid", id: "grid" }),
      el("div", { class: "sentinel", id: "sentinel" })),
  );
  app.append(el("div", { class: "browse" }, el("aside", { class: "sidebar", id: "sidebar" }), content));
  renderSeg();
  renderSortSelect();
  renderBasketButton();
  placeViewbar();
  renderSidebar();
  setupInfiniteScroll();
  renderBanners();
  updateResults();
}

function topbar() {
  const search = el("input", { class: "input", id: "search", type: "search", placeholder: "Search deals", autocomplete: "off", spellcheck: "false" });
  search.addEventListener("input", () => {
    state.query = search.value;
    updateResults();
  });
  const searchToggle = el("button", { class: "btn btn-icon search-toggle", title: "Search", "aria-label": "Search", html: ICON.search });
  searchToggle.addEventListener("click", () => {
    if (document.body.classList.toggle("search-open")) setTimeout(() => search.focus(), 50);
  });
  const viewbar = el("div", { class: "viewbar", id: "viewbar" },
    el("div", { class: "seg", id: "seg", role: "tablist" }),
    el("div", { class: "seg", id: "seg-catalog", role: "tablist" }),
    el("span", { id: "sort-slot" }));
  return el("div", { class: "topbar" },
    el("button", { class: "btn btn-icon filters-btn", title: "Filters", "aria-label": "Show filters", html: ICON.filter, onclick: () => document.body.classList.toggle("filters-open") }),
    isWeb ? el("div", { class: "brand brand-inline" }, el("span", { class: "brand-mark", "aria-hidden": "true", html: ICON.percent }), el("span", { class: "brand-name" }, "Steam Deals")) : null,
    el("span", { id: "viewbar-top" }, viewbar),
    el("div", { class: "search", html: ICON.search }, search, el("kbd", {}, "/")),
    el("div", { class: "spacer" }),
    el("span", { class: "updated", id: "updated" }),
    el("button", { class: "btn btn-icon refresh-btn", title: "Refresh deals", "aria-label": "Refresh", html: ICON.refresh, onclick: () => loadAll({ force: true }) }),
    searchToggle,
    basketButton(),
    accountChip(),
  );
}

/** Narrow screens: the toggles move out of the fixed top bar into the scrolling content. */
export function placeViewbar() {
  const vb = $("#viewbar");
  if (!vb) return;
  const target = NARROW.matches ? $("#viewbar-slot") : $("#viewbar-top");
  if (target && vb.parentElement !== target) target.append(vb);
}

export function renderSeg() {
  const host = $("#seg");
  const cat = $("#seg-catalog");
  if (!host || !cat) return;
  const personal = isPersonal();
  const mode = viewMode();
  const saleOnly = state.settings.catalog !== "all";
  const btn = (on, label, icon, disabled, title, onClick) =>
    el("button", { class: `seg-btn ${on ? "on" : ""}`, role: "tab", "aria-selected": on, disabled, title, html: icon, onclick: onClick }, el("span", {}, label));
  host.replaceChildren(
    btn(mode === "foryou", "For you", ICON.sparkle, !personal, personal ? "Ranked by how well each game matches your library" : "Sign in through Steam to get personal picks", () => setView("foryou")),
    btn(mode === "all", "Browse", ICON.grid, false, "Everything, ranked by score", () => setView("all")),
  );
  cat.replaceChildren(
    btn(saleOnly, "On sale", ICON.tag, false, "Only games currently discounted", () => setCatalog("sale")),
    btn(!saleOnly, "All games", ICON.library, false, "The whole Steam catalog, on sale or not", () => setCatalog("all")),
  );
}

function setView(view) {
  patchSettings({ view }, { persistNow: true });
  syncSortWithView();
  api.settings.update({ sort: state.settings.sort });
  renderSeg();
  renderSortSelect();
  updateResults();
}

function setCatalog(catalog) {
  if (state.settings.catalog === catalog) return;
  const patch = { catalog };
  if (catalog === "all" && Number(state.settings.scanDepth) === 0) patch.scanDepth = 25000; // "everything" only exists for the sale list
  state.deals = [];
  patchSettings(patch, { refetch: true, persistNow: true });
  renderSeg();
  renderSidebar();
}

export function renderSortSelect() {
  const slot = $("#sort-slot");
  if (!slot) return;
  const base = SORTS.filter(([v]) => v !== "match");
  const options = viewMode() === "foryou" ? [["match", "Best match"], ...base] : base;
  const current = options.some(([v]) => v === state.settings.sort) ? state.settings.sort : options[0][0];
  const sort = el("select", { class: "select", id: "sort", "aria-label": "Sort" }, options.map(([v, l]) => el("option", { value: v, selected: current === v }, l)));
  sort.addEventListener("change", () => patchSettings({ sort: sort.value }, { persistNow: true }));
  slot.replaceChildren(sort);
}

export function renderUpdated() {
  const u = $("#updated");
  if (!u) return;
  u.textContent = state.meta.fetchedAt ? `Updated ${timeAgo(state.meta.fetchedAt)}${state.meta.fromCache ? " · cached" : ""}` : "";
}
