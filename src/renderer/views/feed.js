// The scrolling list: banners, the "Your taste" panel, the stats line, and the game cards.
import { PAGE } from "../config.js";
import { $, el, imgEl } from "../lib/dom.js";
import { fmtInt, timeAgo } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { Core, PHONE } from "../lib/platform.js";
import { normWeights, rankDeals } from "../logic/ranking.js";
import { dismissedIds } from "../logic/dismiss.js";
import { dismissedList, patchSettings, state, tagName, tasteModel, viewMode } from "../state.js";
import { loadAll, rebuildTaste } from "../data.js";
import { signInFromBrowse } from "./account.js";
import { basketToggle } from "./basket.js";
import { dismissButton } from "./dismiss.js";
import { openDetails } from "./details.js";
import { openSettings } from "./settings.js";
import { renderSortSelect } from "./shell.js";
import { resetFilters } from "./sidebar.js";

/**
 * Recompute the ranked list and redraw everything that depends on it. With keepPlace the grid keeps its scroll
 * position and as many cards as were already shown (used after "Not interested", which re-ranks in place).
 */
export function updateResults({ keepPlace = false } = {}) {
  if (!$("#grid")) return;
  const personal = viewMode() === "foryou";
  const r = rankDeals({
    deals: state.deals,
    settings: state.settings,
    library: state.library,
    query: state.query,
    personal,
    model: personal ? tasteModel() : null,
    dismissed: dismissedIds(dismissedList()),
  });
  state.results = r.list;
  state.ownedHidden = r.ownedHidden;
  state.personalized = r.personalized;
  state.activeWeights = r.weights;
  renderForYouHead();
  renderStats();
  renderGrid(true, { keepPlace });
}

// ----- banners -----
export function renderBanners() {
  const host = $("#banners");
  if (!host) return;
  const banner = (cls, icon, text, action, label) =>
    el("div", { class: `banner ${cls}` }, el("span", { html: icon }), el("span", {}, text), el("span", { class: "spacer" }), el("button", { class: "btn btn-sm", onclick: action }, label));
  host.replaceChildren();
  if (state.library.sessionExpired) {
    host.append(banner("", ICON.warning, "Your Steam session has expired, so owned games can't be hidden.", signInFromBrowse, "Sign in again"));
  } else if (state.account?.method === "guest") {
    host.append(banner("info", ICON.user, "Browsing as a guest. Sign in to hide games you already own.", signInFromBrowse, "Sign in through Steam"));
  } else if (state.error) {
    host.append(banner("danger", ICON.warning, `Steam didn't respond: ${state.error.message}`, () => loadAll({ force: true }), "Try again"));
  }
}

// ----- the For-you header: what the app learned from the library -----
export function renderForYouHead() {
  const host = $("#foryou-head");
  if (!host) return;
  host.replaceChildren();
  if (viewMode() !== "foryou") return;

  if (state.tasteLoading) {
    const p = state.tasteProgress;
    host.append(el("div", { class: "fy-head" },
      el("div", { class: "fy-title", html: ICON.sparkle }, el("span", {}, "Learning your taste")),
      el("div", { class: "muted" }, p?.total ? `Reading tags for ${fmtInt(p.done)} of ${fmtInt(p.total)} games you own…` : "Looking at your library and playtime…"),
      el("div", { class: "fy-bar" }, el("span", { style: { width: p?.total ? `${(p.done / p.total) * 100}%` : "15%" }, class: p?.total ? "" : "pulse" })),
    ));
    return;
  }

  const t = state.taste;
  if (!t) {
    const expired = state.tasteReason === "session_expired";
    const msg = expired ? "Your Steam session expired. Sign in again to get personal picks."
      : state.tasteReason === "private" ? "Your Steam profile's Game details are private, so your library can't be read. Set them to Public in Steam's privacy settings, or sign in with your own API key, then rebuild."
      : state.tasteReason === "empty" ? "Your library looks empty, so there's nothing to learn from yet."
      : "Couldn't build a taste profile from your library.";
    host.append(el("div", { class: "fy-head" },
      el("div", { class: "fy-title", html: ICON.warning }, el("span", {}, "No taste profile yet")),
      el("div", { class: "muted" }, msg),
      el("div", {}, el("button", { class: "btn btn-sm", onclick: expired ? signInFromBrowse : rebuildTaste }, expired ? "Sign in again" : "Try again"))));
    return;
  }

  const model = tasteModel();
  const phone = PHONE.matches; // phones start with the panel collapsed, and remember that separately
  const shown = phone ? state.settings.showTastePhone === true : state.settings.showTaste !== false;
  const toggle = el("button", {
    class: "btn btn-ghost btn-sm",
    title: shown ? "Hide this panel" : "Show your taste profile",
    "aria-expanded": shown,
    onclick: () => {
      patchSettings(phone ? { showTastePhone: !shown } : { showTaste: !shown }, { persistNow: true });
      renderForYouHead();
    },
  }, shown ? "Hide" : "Show");
  const chips = (model?.topTags || []).map((id) => el("span", { class: "chip on" }, tagName(id)));
  const title = el("div", { class: "fy-title", html: ICON.sparkle }, el("span", {}, "Your taste"));

  if (!shown) {
    host.append(el("div", { class: "fy-head fy-collapsed" },
      el("div", { class: "fy-row" }, title,
        el("span", { class: "muted fy-basis" }, `${fmtInt(chips.length)} signature tags · learned from ${fmtInt(t.basedOn)} games${t.builtAt ? ` · updated ${timeAgo(t.builtAt)}` : ""}`),
        el("div", { class: "spacer" }), toggle)));
    return;
  }
  const basis = `Learned from ${fmtInt(t.basedOn)} of your ${fmtInt(t.libraryCount)} games${t.hasPlaytime ? ", weighted by hours played" : ""}. It re-learns from your playtime every time the app refreshes.`;
  const anchors = t.anchors || [];
  const top = anchors.slice(0, 3).map((a) => (a.hours ? `${a.name} (${fmtInt(Math.round(a.hours))} h)` : a.name)).join(" · ");
  const lately = anchors.filter((a) => a.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 3).map((a) => a.name).join(" · ");
  host.append(el("div", { class: "fy-head" },
    el("div", { class: "fy-row" }, title, el("div", { class: "spacer" }),
      el("button", { class: "btn btn-ghost btn-sm", title: "Re-read your library and playtime now", html: `${ICON.refresh}<span>Rebuild</span>`, onclick: rebuildTaste }),
      toggle),
    el("div", { class: "tags-wrap" }, chips.length ? chips : el("span", { class: "muted" }, "Not enough tagged games to find a pattern yet.")),
    el("div", { class: "muted fy-basis" }, basis, top ? ` Most played: ${top}.` : "", lately ? ` Lately: ${lately}.` : ""),
  ));
}

// ----- the stats line -----
export function renderStats() {
  const host = $("#stats");
  if (!host) return;
  if (state.loading && !state.deals.length) {
    host.replaceChildren(el("span", {}, "Scanning the Steam catalog…"));
    return;
  }
  const list = state.results;
  const saleOnly = state.settings.catalog !== "all";
  const best = list.reduce((m, d) => Math.max(m, d.discount), 0);
  const dot = () => el("span", { class: "dot" });
  const parts = [el("span", {}, el("strong", {}, fmtInt(list.length)), saleOnly ? " deals" : " games")];
  if (state.ownedHidden) parts.push(dot(), el("span", {}, el("strong", {}, fmtInt(state.ownedHidden)), " owned hidden"));
  if (saleOnly && best) {
    const label = ["best discount ", el("strong", {}, `${best}%`)];
    parts.push(dot(), state.settings.sort === "discount"
      ? el("span", {}, label)
      : el("button", { class: "stat-link", title: "Show the biggest discounts first", onclick: () => { patchSettings({ sort: "discount" }, { persistNow: true }); renderSortSelect(); } }, label));
  }
  if (state.meta.total) {
    const what = saleOnly ? "discounted items" : "items on Steam";
    const { scanned, total, streaming } = state.meta;
    parts.push(dot(), el("span", { class: "muted", title: `${fmtInt(state.deals.length)} of those are purchasable games (the rest are DLC, bundles, software, etc.)` },
      streaming ? `scanning… ${fmtInt(scanned)} of ${fmtInt(total)} ${what}` : `scanned the ${fmtInt(scanned)} most popular of ${fmtInt(total)} ${what}`));
  }
  const w = state.activeWeights || normWeights(state.settings.weights);
  const pct = (x) => Math.round(x * 100);
  const label = saleOnly
    ? `Score weights · ${pct(w.discount)} discount / ${pct(w.rating)} rating / ${pct(w.popularity)} popularity`
    : `Score weights · ${pct(w.rating)} rating / ${pct(w.popularity)} popularity`;
  parts.push(el("span", { class: "spacer" }), el("button", { class: "pill pill-info pill-btn", title: "Open settings to change the score weights", onclick: openSettings, html: ICON.settings }, el("span", {}, label)));
  host.replaceChildren(...parts);
}

// ----- the grid (infinite scroll) -----
let observer = null;
export function setupInfiniteScroll() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) appendCards();
  }, { root: $("#scroller"), rootMargin: "600px 0px" });
  observer.observe($("#sentinel"));
}

export function renderGrid(reset, { keepPlace = false } = {}) {
  const grid = $("#grid");
  if (!grid) return;
  const scroller = $("#scroller");
  const place = { top: scroller.scrollTop, shown: state.shown };
  if (reset) {
    grid.replaceChildren();
    state.shown = 0;
    // Keep the reader's place while pages stream in, or when asked to; otherwise start from the top.
    if (!state.meta?.streaming && !keepPlace) scroller.scrollTop = 0;
  }
  if (state.loading && !state.deals.length) {
    for (let i = 0; i < 12; i++) grid.append(el("div", { class: "skeleton" }, el("div", { class: "sk sk-art" }), el("div", { class: "sk sk-line" }), el("div", { class: "sk sk-line short" })));
    return;
  }
  if (!state.results.length) {
    grid.append(emptyState());
    return;
  }
  appendCards(keepPlace ? place.shown : 0);
  if (keepPlace) scroller.scrollTop = place.top;
}

function emptyState() {
  const strict = state.deals.length > 0; // there are deals, the filters just hide them all
  return el("div", { class: "empty", style: { gridColumn: "1 / -1" } },
    el("div", { class: "glyph", html: strict ? ICON.filter : ICON.sparkle }),
    el("h3", {}, strict ? "Nothing matches these filters" : state.error ? "Couldn't reach Steam" : "No deals found"),
    el("p", {}, strict ? "Try a lower minimum discount or rating, or clear your tags." : state.error ? state.error.message : "Steam's query returned nothing. Try refreshing in a moment."),
    strict ? el("button", { class: "btn", onclick: resetFilters }, "Reset filters") : el("button", { class: "btn", onclick: () => loadAll({ force: true }) }, "Refresh"),
  );
}

/** Add the next page of cards (or at least `atLeast` cards in total, to restore a scroll position). */
function appendCards(atLeast = 0) {
  const grid = $("#grid");
  if (!grid || state.shown >= state.results.length) return;
  const frag = document.createDocumentFragment();
  const end = Math.min(state.results.length, Math.max(state.shown + PAGE, atLeast));
  for (let i = state.shown; i < end; i++) frag.append(card(state.results[i], i + 1));
  grid.append(frag);
  state.shown = end;
}

export const ratingClass = (r) => (r == null ? "" : r >= 90 ? "rating-good" : r >= 80 ? "rating-ok" : "");

function card(d, rank) {
  const owned = state.library.owned.has(d.appid);
  const wished = state.library.wishlist.has(d.appid);
  const personal = state.personalized && d.match != null;
  const model = personal ? tasteModel() : null;
  const similar = model ? model.similar(d, 2) : [];
  const ring = personal
    ? el("div", { class: "ring match", style: { "--p": Math.round(d.match) }, title: `${Math.round(d.match)}% match · deal score ${d.score.toFixed(1)} · #${rank}` }, el("span", { class: "num" }, `${Math.round(d.match)}%`))
    : el("div", { class: "ring", style: { "--p": Math.round(d.score) }, title: `Score ${d.score.toFixed(1)} · #${rank}` }, el("span", { class: "num" }, Math.round(d.score)));
  const because = personal
    ? el("div", { class: "because", title: similar.map((x) => x.name).join(", ") },
        similar.length
          ? ["Because you played ", el("b", {}, similar.map((x) => x.name).join(" · "))]
          : ["Matches your taste in ", el("b", {}, model.contributions(d).filter((c) => c.v > 0).slice(0, 2).map((c) => tagName(c.id)).join(" · ") || "these tags")])
    : null;
  // A div with button semantics, not a <button>: the card contains its own basket button, and
  // nested buttons are invalid HTML with inconsistent focus and scroll behaviour.
  const node = el("div", { class: "card", role: "button", tabindex: 0, dataset: { appid: d.appid }, "aria-label": `${d.name}, ${d.discount}% off, ${d.price}` },
    el("div", { class: "card-art" },
      imgEl(d.image, ""),
      d.discount > 0 ? el("span", { class: "badge-discount num" }, `-${d.discount}%`) : null,
      ring,
      owned ? el("span", { class: "ribbon" }, "Owned") : null,
      wished ? el("span", { class: "heart", html: ICON.heart, title: "On your wishlist" }) : null,
    ),
    el("div", { class: "card-body" },
      el("div", { class: "card-title", title: d.name }, d.name),
      because,
      el("div", { class: "price-row" },
        el("span", { class: "price num" }, d.price ?? "—"),
        d.discount > 0 && d.originalPrice ? el("span", { class: "price-orig num" }, d.originalPrice) : null,
        el("span", { class: "spacer" }),
        dismissButton(d),
        basketToggle(d)),
      el("div", { class: `rating-row ${ratingClass(d.rating)}` },
        el("span", { class: "pct num" }, d.rating != null ? `${d.rating}%` : "n/a"),
        d.reviewLabel ? el("span", { class: "lbl" }, d.reviewLabel) : null,
        el("span", { class: "muted num" }, `· ${fmtInt(d.reviews)}`),
        compatBadges(d, true),
      ),
      el("div", { class: "tag-row" }, d.tagids.slice(0, 3).map((t) => el("span", { class: "chip chip-sm" }, tagName(t)))),
    ),
  );
  node.addEventListener("click", () => openDetails(d));
  node.addEventListener("keydown", (e) => {
    if (e.target !== node) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDetails(d);
    }
  });
  return node;
}

// Valve's rating → badge style and the short mark used on cards.
const COMPAT_STYLE = { 3: ["ok", "✓"], 2: ["mid", "~"], 1: ["no", "✕"], 0: ["unknown", "?"] };

/**
 * Steam Deck / Steam Machine ratings, always both devices, so a missing rating never looks like a bug:
 * ✓ Verified, ~ Playable, ✕ Unsupported, ? not rated yet. Cards use the short form; the details panel spells it out.
 */
export function compatBadges(d, compact) {
  return [["Deck", "Steam Deck", d.deck || 0], ["Machine", "Steam Machine", d.machine || 0]].map(([label, device, cat]) => {
    const [cls, mark] = COMPAT_STYLE[cat] || COMPAT_STYLE[0];
    return el("span", { class: `compat-badge ${cls} ${compact ? "compact" : ""}`, title: `${device}: ${Core.COMPAT_LABELS[cat]}` },
      compact ? `${label} ${mark}` : `${label} · ${Core.COMPAT_LABELS[cat]}`);
  });
}
