// The details panel for one game: price, actions, score breakdown, ratings, why it matched, tags.
import { el, imgEl } from "../lib/dom.js";
import { fmtDate, fmtInt } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { api } from "../lib/platform.js";
import { lowestEver, summarizeWindow, WINDOW_DAYS } from "../logic/history.js";
import { normWeights } from "../logic/ranking.js";
import { fmtCents } from "../lib/format.js";
import { loadPoints } from "../history.js";
import { learn } from "../learning.js";
import { state, tagName, tasteModel } from "../state.js";
import { closeDrawer, showDrawer } from "../ui/overlays.js";
import { alertControl } from "./alerts.js";
import { basketToggle } from "./basket.js";
import { dismissButton } from "./dismiss.js";
import { compatBadges, ratingClass } from "./feed.js";

export function openDetails(d) {
  state.selected = d;
  learn("opened", d);
  const owned = state.library.owned.has(d.appid);
  const wished = state.library.wishlist.has(d.appid);
  showDrawer([
    el("div", { class: "drawer-art" }, imgEl(d.image, "loaded"),
      el("button", { class: "btn btn-icon drawer-close", "aria-label": "Close", html: ICON.close, onclick: closeDrawer })),
    el("div", { class: "drawer-body" },
      el("h2", {}, d.name),
      el("div", { class: "meta" },
        el("span", {}, `Released ${fmtDate(d.released)}`),
        d.earlyAccess ? el("span", { class: "chip chip-sm" }, "Early Access") : null,
        compatBadges(d, false),
        owned ? el("span", { class: "chip chip-sm on" }, "In your library") : null,
        wished ? el("span", { class: "chip chip-sm", style: { color: "var(--pink)", borderColor: "rgba(255,126,182,.5)" } }, "On your wishlist") : null,
      ),
      el("div", { class: "buy-row" },
        d.discount > 0 ? el("span", { class: "badge-discount num" }, `-${d.discount}%`) : null,
        el("div", {}, el("div", { class: "price num" }, d.price ?? "—"), d.discount > 0 && d.originalPrice ? el("div", { class: "price-orig num" }, d.originalPrice) : null),
        el("div", { class: "actions" },
          basketToggle(d, { label: true }),
          el("button", { class: "btn btn-sm", title: "Open the store page in your browser", html: `${ICON.external}<span>Open on Steam</span>`, onclick: () => api.openExternal(d.url) }),
          el("button", { class: "btn btn-sm", title: "Open the store page in the Steam app", html: `${ICON.play}<span>Steam app</span>`, onclick: () => api.openExternal(`steam://store/${d.appid}`) }),
          dismissButton(d, { label: true }),
        ),
      ),
      scoreBox(d),
      el("div", { class: `rating-row ${ratingClass(d.rating)}`, style: { fontSize: "13.5px" } },
        el("span", { class: "pct num" }, d.rating != null ? `${d.rating}% positive` : "No rating yet"),
        d.reviewLabel ? el("span", { class: "lbl" }, `· ${d.reviewLabel}`) : null,
        el("span", { class: "muted num" }, `· ${fmtInt(d.reviews)} reviews`),
      ),
      alertControl(d),
      priceHistoryBox(d),
      whyBox(d),
      el("div", { class: "tags-wrap" }, d.tagids.map((t) => el("span", { class: "chip" }, tagName(t)))),
      d.description ? el("p", { class: "desc" }, d.description) : null,
    ),
  ]);
}

/** The deal score as a stacked bar, with how each part was computed. */
function scoreBox(d) {
  const parts = d.parts || { discount: 0, rating: 0, popularity: 0 };
  const w = normWeights(state.settings.weights);
  const pct = (x) => `${Math.max(0, Math.min(100, x))}%`;
  const share = (x) => Math.round(x * 100);
  return el("div", { class: "score-box", title: "How the deal score is worked out: each part times its weight. Change the weights in Settings." },
    el("div", { class: "score-head" }, el("span", { class: "muted" }, "Deal score"), el("span", { class: "big num" }, d.score != null ? d.score.toFixed(1) : "—")),
    el("div", { class: "score-bar" },
      el("span", { class: "s-d", style: { width: pct(parts.discount) } }),
      el("span", { class: "s-r", style: { width: pct(parts.rating) } }),
      el("span", { class: "s-p", style: { width: pct(parts.popularity) } }),
    ),
    el("div", { class: "legend" },
      el("span", {}, el("i", { style: { background: "var(--green)" } }), `Discount ${d.discount}% × ${share(w.discount)}% = ${parts.discount.toFixed(1)}`),
      el("span", {}, el("i", { style: { background: "var(--accent)" } }), `Rating ${d.rating ?? 0}% × ${share(w.rating)}% = ${parts.rating.toFixed(1)}`),
      el("span", {}, el("i", { style: { background: "var(--pink)" } }), `Popularity ${Math.round(d.popularity ?? 0)} × ${share(w.popularity)}% = ${parts.popularity.toFixed(1)}`),
    ),
  );
}

const ITAD_URL = "https://isthereanydeal.com/";
const monthYear = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "");

/**
 * Lowest-ever and 90-day facts from IsThereAnyDeal. Starts empty and fills in when the data arrives; stays empty
 * (takes no space) when there is no data, so nothing is ever shown without backing.
 */
function priceHistoryBox(d) {
  const box = el("div", { class: "history-box", hidden: true });
  loadPoints(d.appid).then((entry) => {
    if (!entry || state.selected?.appid !== d.appid) return;
    const lines = [];
    const ever = lowestEver(entry, d.priceCents);
    if (entry.low) {
      const low = fmtCents(entry.low.cents, d.price);
      lines.push(el("div", { class: "history-line" },
        el("span", { class: "muted" }, "Lowest ever on Steam"),
        el("span", {}, el("b", { class: "num" }, low), entry.low.at ? ` · ${monthYear(entry.low.at)}` : ""),
        ever ? el("span", { class: "history-badge" }, ever.kind === "new" ? "New low right now" : "Matched right now") : null));
    }
    const win = summarizeWindow(entry.points);
    if (win) {
      lines.push(el("div", { class: "history-line" },
        el("span", { class: "muted" }, `Last ${Math.min(WINDOW_DAYS, Math.max(win.coveredDays, 1))} days`),
        el("span", {}, "low ", el("b", { class: "num" }, fmtCents(win.lowCents, d.price)),
          win.typicalCut != null ? ` · typical sale −${win.typicalCut}%` : " · no sales",
          win.saleShare > 0 ? ` · on sale ${Math.round(win.saleShare * 100)}% of the time` : "")));
    } else if (entry.low && Array.isArray(entry.points)) {
      // The log came back empty: say so, so a missing 90-day row doesn't look like a fault. (Dying Light, for
      // one: IsThereAnyDeal stopped logging its Steam price in January 2025.)
      lines.push(el("div", { class: "history-line muted small" }, "No recent price log from IsThereAnyDeal for this game, so no 90-day summary."));
    }
    if (!lines.length) return;
    box.replaceChildren(
      el("div", { class: "score-head" }, el("span", { class: "muted" }, "Price history")),
      ...lines,
      el("div", { class: "muted small" }, "Price history from ",
        el("a", { class: "link", href: "#", onclick: (e) => { e.preventDefault(); api.openExternal(ITAD_URL); } }, "IsThereAnyDeal"), "."));
    box.hidden = false;
  });
  return box;
}

/** "Why this is for you": top contributing tags and the owned games it resembles. */
function whyBox(d) {
  if (!state.personalized || d.match == null) return null;
  const model = tasteModel();
  if (!model) return null;
  const contribs = model.contributions(d);
  const pos = contribs.filter((c) => c.v > 0).slice(0, 4);
  const neg = contribs.filter((c) => c.v < -0.02).slice(-2).reverse();
  const similar = model.similar(d, 3);
  const row = (label, content) => el("div", { class: "why-row" }, el("span", { class: "muted" }, label), content);
  return el("div", { class: "why-box" },
    el("div", { class: "score-head" }, el("span", { class: "muted" }, "Match with your taste"), el("span", { class: "big num match-color" }, `${Math.round(d.match)}%`)),
    pos.length ? row("You tend to play", el("div", { class: "tags-wrap" }, pos.map((c) => el("span", { class: "chip on chip-sm" }, tagName(c.id))))) : null,
    neg.length ? row("Less your thing", el("div", { class: "tags-wrap" }, neg.map((c) => el("span", { class: "chip chip-sm" }, tagName(c.id))))) : null,
    similar.length
      ? row("Similar to games you own", el("div", { class: "why-similar" }, similar.map((x) => el("span", {}, el("b", {}, x.name), x.hours ? el("span", { class: "muted num" }, ` · ${fmtInt(Math.round(x.hours))} h`) : null))))
      : null,
  );
}
