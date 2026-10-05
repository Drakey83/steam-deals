// The filter sidebar (a slide-in sheet on narrow screens): sliders, Plays on, Library, tags, scan depth.
import { DEFAULT_FILTERS, REVIEW_MINS, SCAN_DEPTHS } from "../config.js";
import { $, el } from "../lib/dom.js";
import { fmtInt } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { api } from "../lib/platform.js";
import { patchSettings, state, syncSortWithView, tagName } from "../state.js";
import { switchEl, usersLine } from "../ui/common.js";
import { updateResults } from "./feed.js";
import { openSettings } from "./settings.js";
import { renderSortSelect } from "./shell.js";

const MUTED_NOTE = { fontSize: "12px", marginTop: "4px" };

export function renderSidebar() {
  const side = $("#sidebar");
  if (!side) return;
  const s = state.settings;

  const range = (key, label, min, max, step, fmt) => {
    const val = el("span", { class: "val num" }, fmt(s[key]));
    const input = el("input", { type: "range", min, max, step, value: s[key], "aria-label": label });
    input.addEventListener("input", () => {
      val.textContent = fmt(Number(input.value));
      patchSettings({ [key]: Number(input.value) });
    });
    return el("div", { class: "field" }, el("div", { class: "field-row" }, el("span", {}, label), val), input);
  };
  const toggle = (key, label, disabled = false) => switchEl(label, s[key], (on) => patchSettings({ [key]: on }, { persistNow: true }), { disabled });
  const select = (key, label, options, { refetch = false } = {}) => {
    const sel = el("select", { class: "select", "aria-label": label }, options.map(([v, l]) => el("option", { value: v, selected: String(s[key]) === String(v) }, l)));
    sel.addEventListener("change", () => {
      const v = /^\d+$/.test(sel.value) ? Number(sel.value) : sel.value;
      patchSettings({ [key]: v }, { refetch, persistNow: true });
    });
    return el("div", { class: "field" }, el("div", { class: "field-row" }, el("span", {}, label)), sel);
  };

  const signedIn = state.library.signedIn;
  const saleOnly = s.catalog !== "all";
  side.replaceChildren(
    el("button", { class: "btn btn-sm sidebar-done", onclick: () => document.body.classList.remove("filters-open") }, "Done"),
    el("div", {},
      el("div", { class: "section-title" }, "Filters", el("button", { class: "btn btn-ghost btn-sm", onclick: resetFilters }, "Reset")),
      el("div", { style: { display: "grid", gap: "14px" } },
        saleOnly
          ? range("minDiscount", "Min discount", 50, 95, 5, (v) => `${v}%`)
          : el("div", { class: "muted", style: { fontSize: "12px" } }, "Showing the whole catalog. Switch to “On sale” to filter by discount."),
        range("minRating", "Min rating", 50, 95, 5, (v) => `${v}%`),
        select("minReviews", "Min reviews", REVIEW_MINS),
      ),
    ),
    el("div", {},
      el("div", { class: "section-title" }, "Plays on"),
      toggle("deckMachineOnly", "Steam Deck / Machine only"),
      el("div", { class: "muted", style: MUTED_NOTE }, "On: only games Valve rates Verified (✓) or Playable (~) on Steam Deck or Steam Machine. Off: every game. Cards also mark Unsupported (✕) and not rated yet (?)."),
    ),
    el("div", {},
      el("div", { class: "section-title" }, "Library"),
      toggle("hideOwned", "Hide games I own", !signedIn),
      toggle("wishlistOnly", "Wishlist only", !signedIn),
      signedIn ? null : el("div", { class: "muted", style: MUTED_NOTE }, "Sign in to hide owned games."),
    ),
    el("div", { id: "tags-section" }),
    el("div", { class: "sidebar-foot" },
      select("scanDepth", "Scan depth", SCAN_DEPTHS, { refetch: true }),
      el("button", { class: "btn", html: `${ICON.settings}<span>Settings</span>`, onclick: openSettings }),
      usersLine(),
    ),
  );
  renderTags();
}

export function resetFilters() {
  patchSettings({ ...DEFAULT_FILTERS }, { persistNow: true });
  syncSortWithView();
  api.settings.update({ sort: state.settings.sort });
  state.query = "";
  const search = $("#search");
  if (search) search.value = "";
  renderSidebar();
  renderSortSelect();
  updateResults();
}

/** The tag chips, most common first, with a search box. */
export function renderTags() {
  const host = $("#tags-section");
  if (!host) return;
  const counts = new Map();
  for (const d of state.deals) for (const t of d.tagids) counts.set(t, (counts.get(t) || 0) + 1);
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const selected = new Set(state.settings.selectedTags || []);
  const q = state.tagSearch.trim().toLowerCase();
  const shown = q ? all.filter(([id]) => tagName(id).toLowerCase().includes(q)).slice(0, 40) : all.slice(0, 28);
  for (const id of selected) if (!shown.some(([x]) => x === id)) shown.unshift([id, counts.get(id) || 0]);

  const search = el("input", { class: "input", type: "search", placeholder: "Find a tag", value: state.tagSearch, "aria-label": "Find a tag" });
  search.addEventListener("input", () => {
    state.tagSearch = search.value;
    renderTags();
    $("#tags-section input").focus();
  });
  const setTags = (ids) => {
    patchSettings({ selectedTags: ids }, { persistNow: true });
    renderTags();
  };
  const chips = shown.map(([id, n]) => {
    const on = selected.has(id);
    return el("button", {
      class: `chip ${on ? "on" : ""}`,
      title: `${fmtInt(n)} games`,
      onclick: () => setTags(on ? [...selected].filter((x) => x !== id) : [...selected, id]),
    }, tagName(id));
  });
  host.replaceChildren(
    el("div", { class: "section-title" }, "Tags", selected.size ? el("button", { class: "btn btn-ghost btn-sm", onclick: () => setTags([]) }, "Clear") : null),
    el("div", { class: "tags-search" }, search),
    all.length ? el("div", { class: "tags-wrap" }, chips) : el("div", { class: "muted", style: { fontSize: "12px" } }, "Tags appear once deals load."),
  );
}
