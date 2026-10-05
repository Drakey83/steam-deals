// Steam Deals renderer. No network access here: everything goes through window.steamDeals (preload).
const api = window.steamDeals;
const $ = (sel, root = document) => root.querySelector(sel);

// ---------- tiny DOM helper (text is always escaped; only constant SVG uses `html`) ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") node.innerHTML = v;
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
const svg = (paths, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;
const ICON = {
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>'),
  monitor: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>'),
  sync: svg('<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12a9 9 0 0 1 15.5-6.2"/><path d="M3 17v-5h5"/><path d="M21 7v5h-5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  login: svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>'),
  heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>', 'fill="currentColor" stroke="none"'),
  external: svg('<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>'),
  close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  library: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  percent: svg('<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="16" r="2.6"/><path d="M17 7 7 17"/>', 'stroke-width="2.4"'),
  filter: svg('<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>'),
  sparkle: svg('<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m5.6 18.4 2.8-2.8"/><path d="m15.6 8.4 2.8-2.8"/>'),
  play: svg('<path d="M5 3l14 9-14 9z"/>', 'fill="currentColor" stroke="none"'),
  warning: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
};

// ---------- static data ----------
const COUNTRIES = [
  ["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany (EUR)"], ["FR", "France (EUR)"], ["ES", "Spain (EUR)"],
  ["IT", "Italy (EUR)"], ["NL", "Netherlands (EUR)"], ["PL", "Poland"], ["SE", "Sweden"], ["NO", "Norway"], ["CH", "Switzerland"],
  ["CA", "Canada"], ["MX", "Mexico"], ["BR", "Brazil"], ["AR", "Argentina"], ["CL", "Chile"], ["AU", "Australia"], ["NZ", "New Zealand"],
  ["JP", "Japan"], ["KR", "South Korea"], ["CN", "China"], ["TW", "Taiwan"], ["HK", "Hong Kong"], ["SG", "Singapore"], ["IN", "India"],
  ["TR", "Türkiye"], ["UA", "Ukraine"], ["RU", "Russia"], ["ZA", "South Africa"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["IL", "Israel"],
];
const LANGUAGES = [
  ["english", "English"], ["german", "Deutsch"], ["french", "Français"], ["spanish", "Español"], ["brazilian", "Português (Brasil)"],
  ["russian", "Русский"], ["japanese", "日本語"], ["koreana", "한국어"], ["schinese", "简体中文"], ["tchinese", "繁體中文"],
  ["polish", "Polski"], ["italian", "Italiano"], ["turkish", "Türkçe"],
];
const SORTS = [
  ["score", "Best score"], ["discount", "Biggest discount"], ["rating", "Highest rated"],
  ["reviews", "Most reviewed"], ["price", "Lowest price"], ["name", "Name A–Z"],
];
const REVIEW_MINS = [[0, "Any"], [100, "100+"], [1000, "1,000+"], [10000, "10,000+"], [50000, "50,000+"]];
// Valve's compatibility ratings for the Steam Deck and the Steam Machine: 3 = Verified, 2 = Playable.
const isVerified = (d) => d.deck === 3 || d.machine === 3;
// 0 = everything on sale (~70k items, 2–3 min, streams in). Only offered in sale mode; the full catalog is ~240k.
const SCAN_DEPTHS = [[3000, "Quick · 3,000"], [10000, "Standard · 10,000"], [25000, "Deep · 25,000"], [0, "Everything on sale · ~70,000 · slow"]];
ICON.grid = svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>');
ICON.tag = svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>');
const PAGE = 60;
const DEFAULT_FILTERS = { minDiscount: 50, minRating: 80, minReviews: 0, selectedTags: [], wishlistOnly: false, hideOwned: true, sort: "score", verifiedOnly: false };

// ---------- state ----------
const state = {
  settings: null,
  account: null,
  tags: {},
  deals: [],
  meta: { total: null, fetchedAt: null, fromCache: false, truncated: false },
  library: { owned: new Set(), wishlist: new Set(), signedIn: false, sessionExpired: false },
  loading: false,
  error: null,
  query: "",
  tagSearch: "",
  results: [],
  shown: 0,
  selected: null,
  menuEl: null,
  taste: null, // { affinity, anchors, basedOn, hasPlaytime, libraryCount, source }
  tasteLoading: false,
  tasteReason: null,
  tasteProgress: null,
  _tasteModel: null,
};
let saveTimer = null;
let observer = null;

// ---------- formatting ----------
const fmtInt = (n) => Number(n || 0).toLocaleString("en-US");
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
function timeAgo(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function normWeights(w) {
  const d = Math.max(0, Number(w?.discount ?? 40));
  const r = Math.max(0, Number(w?.rating ?? 35));
  const p = Math.max(0, Number(w?.popularity ?? 25));
  const sum = d + r + p || 1;
  return { discount: d / sum, rating: r / sum, popularity: p / sum };
}
const tagName = (id) => state.tags[id] || `#${id}`;

// ---------- toasts ----------
function toast(message, { type = "", action, actionLabel = "Retry", timeout = 5000 } = {}) {
  const host = $("#toasts");
  const node = el("div", { class: `toast ${type}`, role: "status" }, el("span", {}, message));
  if (action) {
    node.append(
      el("button", { class: "btn btn-sm", onclick: () => { node.remove(); action(); } }, actionLabel),
    );
  }
  host.append(node);
  setTimeout(() => node.remove(), timeout);
}

// ---------- progress ----------
function setProgress(p) {
  const bar = $("#progress");
  const status = $("#titlebar-status");
  if (!p) {
    bar.hidden = true;
    bar.classList.remove("indeterminate");
    status.textContent = "";
    return;
  }
  bar.hidden = false;
  if (p.target) {
    bar.classList.remove("indeterminate");
    $(".progress-bar", bar).style.width = `${Math.min(100, (p.fetched / p.target) * 100)}%`;
    status.textContent = `Scanning Steam · ${fmtInt(p.fetched)} / ${fmtInt(p.target)}`;
  } else {
    bar.classList.add("indeterminate");
    status.textContent = p.label || "Loading…";
  }
}

// ---------- data loading ----------
async function loadAll({ force = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  state.tasteLoading = true;
  state.tasteProgress = null;
  setProgress({ label: "Connecting to Steam…" });
  renderStats();
  renderGrid(true);
  renderForYouHead();

  // Taste profile builds concurrently; deals render as soon as they arrive.
  const tasteP = api.taste.build({ force }).catch((e) => ({ ok: false, error: { message: e.message } }));
  const [tagsRes, libRes, dealsRes] = await Promise.all([
    api.tags.fetch(),
    api.library.fetch({ force }),
    api.deals.fetch({ force }),
  ]);

  if (tagsRes.ok) state.tags = tagsRes.tags || {};
  if (libRes.ok) {
    state.library = {
      owned: new Set(libRes.owned || []),
      wishlist: new Set(libRes.wishlist || []),
      signedIn: Boolean(libRes.signedIn),
      sessionExpired: Boolean(libRes.sessionExpired),
    };
  } else {
    state.library.sessionExpired = false;
    toast(`Couldn't load your library: ${libRes.error.message}`, { type: "err", action: () => loadAll({ force: true }) });
  }
  if (dealsRes.ok) {
    state.deals = dealsRes.items || [];
    state._tasteModel = null;
    state.meta = {
      total: dealsRes.total,
      scanned: dealsRes.scanned || (dealsRes.items || []).length,
      fetchedAt: dealsRes.fetchedAt,
      fromCache: Boolean(dealsRes.fromCache),
      truncated: Boolean(dealsRes.truncated),
      discounted: dealsRes.discounted !== false,
      streaming: false,
    };
  } else if (dealsRes.error.code !== "cancelled") {
    state.error = dealsRes.error;
    toast(`Couldn't load deals: ${dealsRes.error.message}`, { type: "err", action: () => loadAll({ force: true }) });
  }
  state.loading = false;
  state.streamRun = null;
  setProgress(null);
  syncSortWithView();
  renderSidebar(); // library state affects the toggles; deals affect the tag list
  renderSeg();
  renderSortSelect();
  renderBanners();
  updateResults();
  renderUpdated();

  const tasteRes = await tasteP;
  applyTaste(tasteRes);
}

// Pages arrive while the scan runs; show them right away instead of waiting for the whole depth.
let streamTimer = null;
function onDealsPartial(p) {
  if (!state.loading || !p) return;
  if (state.streamRun !== p.runId) {
    state.streamRun = p.runId;
    state.deals = [];
    state.streamSeen = new Set();
  }
  for (const it of p.items || []) {
    if (!state.streamSeen.has(it.appid)) {
      state.streamSeen.add(it.appid);
      state.deals.push(it);
    }
  }
  state.meta = { ...state.meta, total: p.total, scanned: p.scanned, discounted: p.discounted !== false, streaming: true };
  state._tasteModel = null;
  if (streamTimer) return;
  streamTimer = setTimeout(() => {
    streamTimer = null;
    if (state.loading) {
      renderTags();
      updateResults();
    }
  }, 700);
}

function applyTaste(res) {
  state.tasteLoading = false;
  state.tasteProgress = null;
  state._tasteModel = null;
  if (res?.ok) {
    state.taste = res.taste || null;
    state.tasteReason = res.reason || null;
  } else {
    state.taste = null;
    state.tasteReason = "error";
    if (res?.error?.message) toast(`Couldn't build your taste profile: ${res.error.message}`, { type: "err", action: rebuildTaste });
  }
  updateResults();
}

async function rebuildTaste() {
  if (state.tasteLoading) return;
  state.tasteLoading = true;
  state.tasteProgress = null;
  renderForYouHead();
  const r = await api.taste.build({ force: true }).catch((e) => ({ ok: false, error: { message: e.message } }));
  applyTaste(r);
  if (r?.ok && r.taste) toast(`Taste profile rebuilt from ${fmtInt(r.taste.basedOn)} games`, { type: "ok" });
}

async function refreshLibrary() {
  const r = await api.library.fetch({ force: true });
  if (!r.ok) return toast(r.error.message, { type: "err" });
  state.library = { owned: new Set(r.owned || []), wishlist: new Set(r.wishlist || []), signedIn: Boolean(r.signedIn), sessionExpired: Boolean(r.sessionExpired) };
  syncSortWithView();
  renderSidebar();
  renderSeg();
  renderBanners();
  updateResults();
  if (r.signedIn) toast(`Library refreshed · ${fmtInt(r.owned.length)} games`, { type: "ok" });
  rebuildTaste();
}

// ---------- view mode (For you / All deals) ----------
function isPersonal() {
  return Boolean(state.library.signedIn && state.account && state.account.method !== "guest");
}
function viewMode() {
  return isPersonal() && state.settings.view !== "all" ? "foryou" : "all";
}
function syncSortWithView() {
  const s = state.settings;
  const before = s.sort;
  if (viewMode() === "foryou" && s.sort === "score") s.sort = "match";
  if (viewMode() === "all" && s.sort === "match") s.sort = "score";
  if (s.sort !== before) api.settings.update({ sort: s.sort });
}
function setView(view) {
  patchSettings({ view }, { persistNow: true });
  syncSortWithView();
  api.settings.update({ sort: state.settings.sort });
  renderSeg();
  renderSortSelect();
  updateResults();
}

// Tag "lift": how much more the person's library leans into a tag than the discounted
// catalog does. Ubiquitous tags (Singleplayer, Indie…) end up near zero; distinctive
// tastes (Roguelike, Souls-like, Farming Sim…) end up strongly positive or negative.
function tasteModel() {
  const t = state.taste;
  if (!t || !t.affinity) return null;
  if (state._tasteModel && state._tasteModel.deals === state.deals) return state._tasteModel;
  const base = new Map();
  for (const d of state.deals) for (const tg of d.tags || []) base.set(tg.id, (base.get(tg.id) || 0) + tg.w);
  const n = state.deals.length || 1;
  const EPS = 1e-4;
  const lift = new Map();
  const ids = new Set([...Object.keys(t.affinity).map(Number), ...base.keys()]);
  for (const id of ids) {
    const a = (t.affinity[id] || 0) + EPS;
    const b = (base.get(id) || 0) / n + EPS;
    lift.set(id, Math.max(-2.5, Math.min(3, Math.log2(a / b))));
  }
  const topTags = Object.entries(t.affinity)
    .map(([id, a]) => ({ id: Number(id), score: a * Math.max(0, lift.get(Number(id)) ?? 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => x.id);
  const anchorVecs = (t.anchors || []).map((a) => {
    const m = new Map(a.tags.map((tg) => [tg.id, tg.w]));
    const norm = Math.sqrt([...m.values()].reduce((s, w) => s + w * w, 0)) || 1;
    return { ...a, m, norm };
  });
  const model = {
    deals: state.deals,
    lift,
    topTags,
    raw: (d) => (d.tags || []).reduce((s, tg) => s + tg.w * (lift.get(tg.id) ?? 0), 0),
    contributions: (d) => (d.tags || []).map((tg) => ({ id: tg.id, v: tg.w * (lift.get(tg.id) ?? 0) })).sort((a, b) => b.v - a.v),
    similar: (d, k = 2) => {
      const dn = Math.sqrt((d.tags || []).reduce((s, tg) => s + tg.w * tg.w, 0)) || 1;
      return anchorVecs
        .map((a) => ({ name: a.name, hours: a.hours, appid: a.appid, sim: (d.tags || []).reduce((s, tg) => s + tg.w * (a.m.get(tg.id) || 0), 0) / (dn * a.norm) }))
        .filter((x) => x.sim >= 0.28 && x.appid !== d.appid)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, k);
    },
  };
  state._tasteModel = model;
  return model;
}

// Settings that don't change which games are shown or in what order. Changing them must not
// redraw the grid (which would also scroll it back to the top).
const NON_RESULT_KEYS = new Set(["basket", "taxRegion", "taxCustomRate", "taxRegionAuto", "showTaste", "showTastePhone", "pairAutoCart", "syncPaused", "closeToTray", "startWithWindows"]);

function patchSettings(patch, { refetch = false, persistNow = false } = {}) {
  state.settings = { ...state.settings, ...patch };
  clearTimeout(saveTimer);
  const save = () => api.settings.update(patch);
  if (persistNow) save();
  else saveTimer = setTimeout(save, 300);
  if (refetch) {
    api.deals.cancel();
    state.loading = false;
    loadAll();
  } else if (Object.keys(patch).some((k) => !NON_RESULT_KEYS.has(k))) {
    updateResults();
  }
}

// ---------- results ----------
function computeResults() {
  const s = state.settings;
  const lib = state.library;
  const mode = viewMode();
  const personal = mode === "foryou";
  const saleOnly = s.catalog !== "all";
  const hideOwned = (s.hideOwned || personal) && lib.signedIn;
  const tags = s.selectedTags || [];
  // For-you keeps a quality floor so recommendations are credible even with loose filters.
  const minRating = personal ? Math.max(s.minRating, 80) : s.minRating;
  const minReviews = personal ? Math.max(s.minReviews, 300) : s.minReviews;
  const base = state.deals.filter((d) => (!saleOnly || d.discount >= s.minDiscount) && (d.rating ?? -1) >= minRating && d.reviews >= minReviews);
  const ownedInBase = lib.signedIn ? base.filter((d) => lib.owned.has(d.appid)).length : 0;
  let pool = hideOwned ? base.filter((d) => !lib.owned.has(d.appid)) : base;
  if (s.wishlistOnly && lib.signedIn) pool = pool.filter((d) => lib.wishlist.has(d.appid));
  if (tags.length) pool = pool.filter((d) => tags.every((t) => d.tagids.includes(t)));
  if (s.verifiedOnly) pool = pool.filter(isVerified);

  // Score: discount / rating / popularity. In All-games mode discount drops out so the
  // ranking is "best games", not "best bargains".
  const maxReviews = pool.reduce((m, d) => Math.max(m, d.reviews), 1);
  const logMax = Math.log10(maxReviews) || 1;
  const w = saleOnly ? normWeights(s.weights) : normWeights({ discount: 0, rating: s.weights?.rating ?? 35, popularity: s.weights?.popularity ?? 25 });
  state.activeWeights = w;
  for (const d of pool) {
    d.popularity = d.reviews > 0 ? (100 * Math.log10(d.reviews)) / logMax : 0;
    d.parts = { discount: w.discount * d.discount, rating: w.rating * (d.rating ?? 0), popularity: w.popularity * d.popularity };
    d.score = d.parts.discount + d.parts.rating + d.parts.popularity;
  }

  // Taste match: z-scored tag lift squashed to 0–100, then blended with the deal score.
  const model = personal ? tasteModel() : null;
  if (model && pool.length) {
    const raws = pool.map((d) => model.raw(d));
    const mean = raws.reduce((a, b) => a + b, 0) / raws.length;
    const sd = Math.sqrt(raws.reduce((a, r) => a + (r - mean) ** 2, 0) / raws.length) || 1;
    const p = Math.max(0, Math.min(100, Number(s.personalWeight ?? 60))) / 100;
    pool.forEach((d, i) => {
      d.match = 100 / (1 + Math.exp(-1.4 * ((raws[i] - mean) / sd)));
      d.recScore = p * d.match + (1 - p) * d.score;
    });
  } else {
    for (const d of pool) {
      d.match = null;
      d.recScore = d.score;
    }
  }

  const q = state.query.trim().toLowerCase();
  let list = q ? pool.filter((d) => d.name.toLowerCase().includes(q)) : pool.slice();
  const by = {
    match: (a, b) => b.recScore - a.recScore,
    score: (a, b) => b.score - a.score,
    discount: (a, b) => b.discount - a.discount || b.recScore - a.recScore,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews,
    reviews: (a, b) => b.reviews - a.reviews,
    price: (a, b) => (a.priceCents ?? 1e12) - (b.priceCents ?? 1e12) || b.recScore - a.recScore,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const sortKey = s.sort === "match" && !model ? "score" : s.sort;
  list.sort(by[sortKey] || by.score);
  return { list, ownedHidden: hideOwned ? ownedInBase : 0, poolSize: pool.length, mode, personalized: Boolean(model) };
}

function updateResults() {
  if (!$("#grid")) return;
  const r = computeResults();
  state.results = r.list;
  state.ownedHidden = r.ownedHidden;
  state.mode = r.mode;
  state.personalized = r.personalized;
  renderForYouHead();
  renderStats();
  renderGrid(true);
}

// ---------- views: sign in ----------
function renderLogin() {
  const app = $("#app");
  app.innerHTML = "";
  setProgress(null);
  $("#titlebar-status").textContent = "";

  const signInBtn = el("button", { class: "btn btn-steam", html: `${ICON.login}<span>Sign in through Steam</span>` });
  const guestBtn = el("button", { class: "btn btn-ghost" }, "Browse as guest");

  signInBtn.addEventListener("click", async () => {
    signInBtn.disabled = true;
    signInBtn.innerHTML = `${ICON.login}<span>Waiting for Steam…</span>`;
    const r = await api.auth.signIn();
    if (r.ok && r.account) {
      state.account = r.account;
      enterBrowse();
      toast(`Welcome, ${r.account.name}`, { type: "ok" });
      return;
    }
    signInBtn.disabled = false;
    signInBtn.innerHTML = `${ICON.login}<span>Sign in through Steam</span>`;
    if (!r.ok) toast(r.error.message, { type: "err" });
  });
  guestBtn.addEventListener("click", async () => {
    const r = await api.auth.continueAsGuest();
    if (r.ok) {
      state.account = r.account;
      enterBrowse();
    }
  });

  const keyInput = el("input", { class: "input", type: "password", placeholder: "Steam Web API key", autocomplete: "off", spellcheck: "false" });
  const idInput = el("input", { class: "input", type: "text", placeholder: "SteamID64 or profile name", autocomplete: "off", spellcheck: "false" });
  const keyBtn = el("button", { class: "btn btn-sm" }, "Continue with API key");
  keyBtn.addEventListener("click", async () => {
    keyBtn.disabled = true;
    const r = await api.auth.useApiKey({ apiKey: keyInput.value, steamIdOrVanity: idInput.value });
    keyBtn.disabled = false;
    if (!r.ok) return toast(r.error.message, { type: "err", timeout: 7000 });
    state.account = r.account;
    enterBrowse();
    toast(`Found ${fmtInt(r.ownedCount)} games in your library`, { type: "ok" });
  });

  const web = api.platform === "web";
  const canSignIn = !web || api.features?.steamSignIn;
  const keyHint = web
    ? ["Get a free key at ", linkTo("https://steamcommunity.com/dev/apikey", "steamcommunity.com/dev/apikey"), ". It stays in this browser and is only ever sent on to Steam."]
    : ["Get a free key at ", linkTo("https://steamcommunity.com/dev/apikey", "steamcommunity.com/dev/apikey"), ". Your profile's Game details must be public."];
  const foot = web
    ? "Sign in on Steam's own page: this site never sees your password and only reads your game list and playtime. Signing in needs your profile's Game details set to Public. Your settings stay in this browser."
    : "You sign in on Steam's own page. This app never sees your password and only reads which games you own. Nothing leaves your computer except requests to Steam.";
  const card = el(
    "div",
    { class: "login-card" },
    el("div", { class: "login-logo", html: ICON.percent }),
    el("h1", {}, "Steam Deals"),
    el("p", { class: "tagline" }, "The best discounts on Steam right now, minus everything you already own."),
    el("div", { class: "login-actions" }, canSignIn ? signInBtn : null, guestBtn),
    el(
      "details",
      { class: "advanced", open: !canSignIn },
      el("summary", {}, canSignIn ? "Use a Steam Web API key instead" : "Use your Steam Web API key"),
      el(
        "div",
        { class: "advanced-form" },
        el("label", {}, "API key"),
        keyInput,
        el("label", {}, "Your Steam account"),
        idInput,
        el("div", { class: "hint" }, ...keyHint),
        keyBtn,
      ),
    ),
    el("p", { class: "login-foot" }, foot),
    web ? el("p", { class: "login-app" }, linkTo("/app", "Have a Windows PC? Get the free app"), ": it keeps your Steam cart in sync with your basket, from this site or your phone.") : el("span"),
    usersLine(),
  );
  app.append(el("div", { class: "login" }, el("div", { class: "blobs" }, el("div", { class: "blob blob-a" }), el("div", { class: "blob blob-b" }), el("div", { class: "blob blob-c" })), card));
}

// Small anonymous user count (website only; hidden when the counter isn't set up).
function usersLine() {
  const u = api.features?.users;
  if (!u || !u.total) return null;
  const week = u.week ? ` · ${fmtInt(u.week)} this week` : "";
  return el("div", { class: "users-line num", title: "Counted anonymously: one random id per browser, no names or Steam accounts." },
    `${fmtInt(u.total)} ${u.total === 1 ? "person has" : "people have"} used Steam Deals${week}`);
}

function linkTo(url, label) {
  return el("a", { class: "link", href: "#", onclick: (e) => { e.preventDefault(); api.openExternal(url); } }, label);
}

function enterBrowse() {
  state.library = { owned: new Set(), wishlist: new Set(), signedIn: false, sessionExpired: false };
  renderBrowse();
  loadAll();
}

// ---------- views: browse ----------
function renderBrowse() {
  const app = $("#app");
  app.innerHTML = "";
  const sidebar = el("aside", { class: "sidebar", id: "sidebar" });
  const content = el(
    "section",
    { class: "content" },
    renderTopbar(),
    el("div", { class: "scroller", id: "scroller" },
      el("div", { id: "viewbar-slot" }), // the view/catalog toggles land here on narrow screens so they scroll away
      el("div", { id: "banners" }),
      el("div", { class: "stats", id: "stats" }),
      el("div", { id: "foryou-head" }),
      el("div", { class: "grid", id: "grid" }),
      el("div", { class: "sentinel", id: "sentinel" })),
  );
  app.append(el("div", { class: "browse" }, sidebar, content));
  placeViewbar();
  renderSidebar();
  setupInfiniteScroll();
  renderBanners();
  updateResults();
}

function renderTopbar() {
  const search = el("input", { class: "input", id: "search", type: "search", placeholder: "Search deals", autocomplete: "off", spellcheck: "false" });
  search.addEventListener("input", () => {
    state.query = search.value;
    updateResults();
  });
  const refresh = el("button", { class: "btn btn-icon refresh-btn", title: "Refresh deals", "aria-label": "Refresh", html: ICON.refresh });
  refresh.addEventListener("click", () => loadAll({ force: true }));
  const filtersBtn = el("button", { class: "btn btn-icon filters-btn", title: "Filters", "aria-label": "Show filters", html: ICON.filter });
  filtersBtn.addEventListener("click", () => document.body.classList.toggle("filters-open"));
  const searchToggle = el("button", { class: "btn btn-icon search-toggle", title: "Search", "aria-label": "Search", html: ICON.search });
  searchToggle.addEventListener("click", () => {
    const open = document.body.classList.toggle("search-open");
    if (open) setTimeout(() => search.focus(), 50);
  });
  const viewbar = el("div", { class: "viewbar", id: "viewbar" },
    el("div", { class: "seg", id: "seg", role: "tablist" }),
    el("div", { class: "seg", id: "seg-catalog", role: "tablist" }),
    el("span", { id: "sort-slot" }));
  const bar = el(
    "div",
    { class: "topbar" },
    filtersBtn,
    api.platform === "web"
      ? el("div", { class: "brand brand-inline" }, el("span", { class: "brand-mark", "aria-hidden": "true", html: ICON.percent }), el("span", { class: "brand-name" }, "Steam Deals"))
      : null,
    el("span", { id: "viewbar-top" }, viewbar),
    el("div", { class: "search", html: ICON.search }, search, el("kbd", {}, "/")),
    el("div", { class: "spacer" }),
    el("span", { class: "updated", id: "updated" }),
    refresh,
    searchToggle,
    basketButtonEl(),
    renderAccountChip(),
  );
  queueMicrotask(renderBasketButton);
  // Fill after the bar exists so helpers can re-render these pieces later.
  queueMicrotask(() => {
    renderSeg();
    renderSortSelect();
  });
  return bar;
}

// Narrow screens (tablets in portrait, phones, short landscape phones): the view/catalog toggles move out of the
// fixed top bar into the scrolling content. PHONE is the subset where the taste panel starts collapsed.
const NARROW = window.matchMedia("(max-width: 860px), (max-height: 500px)");
const PHONE = window.matchMedia("(max-width: 640px), (max-height: 500px)");
function placeViewbar() {
  const vb = $("#viewbar");
  if (!vb) return;
  const target = NARROW.matches ? $("#viewbar-slot") : $("#viewbar-top");
  if (target && vb.parentElement !== target) target.append(vb);
}
NARROW.addEventListener("change", placeViewbar);
PHONE.addEventListener("change", renderForYouHead);

function renderSeg() {
  const host = $("#seg");
  const cat = $("#seg-catalog");
  if (!host || !cat) return;
  host.innerHTML = "";
  cat.innerHTML = "";
  const personal = isPersonal();
  const mode = viewMode();
  const saleOnly = state.settings.catalog !== "all";
  const btn = (on, label, icon, disabled, title, onClick) => {
    const b = el("button", { class: `seg-btn ${on ? "on" : ""}`, role: "tab", "aria-selected": on, disabled, title, html: icon }, el("span", {}, label));
    b.addEventListener("click", onClick);
    return b;
  };
  host.append(
    btn(mode === "foryou", "For you", ICON.sparkle, !personal, personal ? "Ranked by how well each game matches your library" : "Sign in through Steam to get personal picks", () => setView("foryou")),
    btn(mode === "all", "Browse", ICON.grid, false, "Everything, ranked by score", () => setView("all")),
  );
  cat.append(
    btn(saleOnly, "On sale", ICON.tag, false, "Only games currently discounted", () => setCatalog("sale")),
    btn(!saleOnly, "All games", ICON.library, false, "The whole Steam catalog, on sale or not", () => setCatalog("all")),
  );
}

function setCatalog(catalog) {
  if (state.settings.catalog === catalog) return;
  const depth = Number(state.settings.scanDepth);
  const patch = { catalog };
  if (catalog === "all" && depth === 0) patch.scanDepth = 25000; // "everything" only exists for the sale list
  state.deals = [];
  state._tasteModel = null;
  patchSettings(patch, { refetch: true, persistNow: true });
  renderSeg();
  renderSidebar();
}

function renderSortSelect() {
  const slot = $("#sort-slot");
  if (!slot) return;
  const mode = viewMode();
  const options = mode === "foryou" ? [["match", "Best match"], ...SORTS.filter(([v]) => v !== "match")] : SORTS.filter(([v]) => v !== "match");
  const current = options.some(([v]) => v === state.settings.sort) ? state.settings.sort : options[0][0];
  const sort = el("select", { class: "select", id: "sort", "aria-label": "Sort" }, options.map(([v, l]) => el("option", { value: v, selected: current === v }, l)));
  sort.addEventListener("change", () => patchSettings({ sort: sort.value }, { persistNow: true }));
  slot.innerHTML = "";
  slot.append(sort);
}

function renderUpdated() {
  const u = $("#updated");
  if (!u) return;
  u.textContent = state.meta.fetchedAt ? `Updated ${timeAgo(state.meta.fetchedAt)}${state.meta.fromCache ? " · cached" : ""}` : "";
}

function avatarEl(account, cls = "avatar") {
  if (account?.avatar) return el("img", { class: cls, src: account.avatar, alt: "" });
  return el("span", { class: cls, html: ICON.user, style: { display: "grid", placeItems: "center", color: "#fff", padding: "5px" } });
}

function renderAccountChip() {
  const a = state.account;
  const chip = el("button", { class: "account", id: "account", "aria-haspopup": "menu" }, avatarEl(a), el("span", { class: "name" }, a?.name || "Guest"));
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(chip);
  });
  return chip;
}

function toggleMenu(anchor) {
  if (state.menuEl) return closeMenu();
  const a = state.account;
  const items = [];
  const item = (icon, label, onClick, cls = "") =>
    el("button", { class: `menu-item ${cls}`, role: "menuitem", html: icon, onclick: () => { closeMenu(); onClick(); } }, el("span", {}, label));
  const menu = el("div", { class: "menu", role: "menu" });
  if (a && a.method !== "guest") {
    menu.append(
      el("div", { class: "menu-head" }, avatarEl(a), el("div", {}, el("div", { style: { fontWeight: 600 } }, a.name), el("div", { class: "sub" }, a.method === "steam" ? "Signed in through Steam" : "Using a Steam Web API key"))),
    );
    items.push(item(ICON.library, "Refresh library", refreshLibrary));
    items.push(item(ICON.external, "View Steam profile", () => api.openExternal(`https://steamcommunity.com/profiles/${a.steamid}/`)));
  } else {
    items.push(item(ICON.login, "Sign in through Steam", signInFromBrowse));
  }
  items.push(item(ICON.refresh, "Refresh deals", () => loadAll({ force: true })));
  items.push(item(ICON.settings, "Settings", openSettings));
  if (a && a.method !== "guest") items.push(item(ICON.logout, "Sign out", signOut, "btn-danger"));
  else items.push(item(ICON.logout, "Back to start", signOut));
  menu.append(...items);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 8}px`;
  menu.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  state.menuEl = menu;
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}
function closeMenu() {
  state.menuEl?.remove();
  state.menuEl = null;
}

async function signInFromBrowse() {
  const r = await api.auth.signIn();
  if (r.ok && r.account) {
    state.account = r.account;
    $("#account")?.replaceWith(renderAccountChip());
    closeModal();
    await refreshLibrary();
    renderBanners();
    toast(`Welcome, ${r.account.name}`, { type: "ok" });
  } else if (!r.ok) toast(r.error.message, { type: "err" });
}

async function signOut() {
  await api.deals.cancel();
  const r = await api.auth.signOut();
  if (r.ok) state.settings = r.settings;
  state.account = null;
  state.loading = false;
  closeDrawer();
  closeModal();
  renderLogin();
}

// ----- sidebar -----
function renderSidebar() {
  const s = state.settings;
  const side = $("#sidebar");
  side.innerHTML = "";

  const range = (key, label, min, max, step, fmt) => {
    const val = el("span", { class: "val num" }, fmt(s[key]));
    const input = el("input", { type: "range", min, max, step, value: s[key], "aria-label": label });
    input.addEventListener("input", () => {
      val.textContent = fmt(Number(input.value));
      patchSettings({ [key]: Number(input.value) });
    });
    return el("div", { class: "field" }, el("div", { class: "field-row" }, el("span", {}, label), val), input);
  };
  const toggle = (key, label, disabled = false) => {
    const input = el("input", { type: "checkbox", checked: Boolean(s[key]), disabled });
    input.addEventListener("change", () => patchSettings({ [key]: input.checked }, { persistNow: true }));
    return el("label", { class: "toggle", style: disabled ? { opacity: 0.5 } : {} }, el("span", {}, label), input, el("span", { class: "switch" }));
  };
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
  const depths = saleOnly ? SCAN_DEPTHS : SCAN_DEPTHS.filter(([v]) => v !== 0);
  side.append(
    el("button", { class: "btn btn-sm sidebar-done", onclick: () => document.body.classList.remove("filters-open") }, "Done"),
    el("div", {}, el("div", { class: "section-title" }, "Filters", el("button", { class: "btn btn-ghost btn-sm", onclick: resetFilters }, "Reset")),
      el("div", { style: { display: "grid", gap: "14px" } },
        saleOnly ? range("minDiscount", "Min discount", 50, 95, 5, (v) => `${v}%`) : el("div", { class: "muted", style: { fontSize: "12px" } }, "Showing the whole catalog. Switch to “On sale” to filter by discount."),
        range("minRating", "Min rating", 50, 95, 5, (v) => `${v}%`),
        select("minReviews", "Min reviews", REVIEW_MINS),
      ),
    ),
    el("div", {}, el("div", { class: "section-title" }, "Plays on"),
      toggle("verifiedOnly", "Verified only"),
      el("div", { class: "muted", style: { fontSize: "12px", marginTop: "4px" } }, "Only games Valve has marked Verified for Steam Deck or Steam Machine. Verified games carry a Deck ✓ or Machine ✓ badge."),
    ),
    el("div", {}, el("div", { class: "section-title" }, "Library"),
      toggle("hideOwned", "Hide games I own", !signedIn),
      toggle("wishlistOnly", "Wishlist only", !signedIn),
      !signedIn && el("div", { class: "muted", style: { fontSize: "12px", marginTop: "4px" } }, "Sign in to hide owned games."),
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

function resetFilters() {
  patchSettings({ ...DEFAULT_FILTERS }, { persistNow: true });
  syncSortWithView();
  api.settings.update({ sort: state.settings.sort });
  state.query = "";
  const s = $("#search");
  if (s) s.value = "";
  renderSidebar();
  renderSortSelect();
  updateResults();
}

function renderTags() {
  const host = $("#tags-section");
  if (!host) return;
  host.innerHTML = "";
  const counts = new Map();
  for (const d of state.deals) for (const t of d.tagids) counts.set(t, (counts.get(t) || 0) + 1);
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const selected = new Set(state.settings.selectedTags || []);
  const q = state.tagSearch.trim().toLowerCase();
  let shown = q ? all.filter(([id]) => tagName(id).toLowerCase().includes(q)).slice(0, 40) : all.slice(0, 28);
  for (const id of selected) if (!shown.some(([x]) => x === id)) shown.unshift([id, counts.get(id) || 0]);

  const search = el("input", { class: "input", type: "search", placeholder: "Find a tag", value: state.tagSearch, "aria-label": "Find a tag" });
  search.addEventListener("input", () => {
    state.tagSearch = search.value;
    renderTags();
    $("#tags-section input").focus();
  });
  const wrap = el("div", { class: "tags-wrap" });
  for (const [id, n] of shown) {
    const on = selected.has(id);
    const chip = el("button", { class: `chip ${on ? "on" : ""}`, title: `${fmtInt(n)} games` }, tagName(id));
    chip.addEventListener("click", () => {
      const next = new Set(selected);
      on ? next.delete(id) : next.add(id);
      patchSettings({ selectedTags: [...next] }, { persistNow: true });
      renderTags();
    });
    wrap.append(chip);
  }
  host.append(
    el("div", { class: "section-title" }, "Tags", selected.size ? el("button", { class: "btn btn-ghost btn-sm", onclick: () => { patchSettings({ selectedTags: [] }, { persistNow: true }); renderTags(); } }, "Clear") : null),
    el("div", { class: "tags-search" }, search),
    all.length ? wrap : el("div", { class: "muted", style: { fontSize: "12px" } }, "Tags appear once deals load."),
  );
}

// ----- banners & stats -----
function renderBanners() {
  const host = $("#banners");
  if (!host) return;
  host.innerHTML = "";
  const a = state.account;
  if (state.library.sessionExpired) {
    host.append(
      el("div", { class: "banner" }, el("span", { html: ICON.warning }), el("span", {}, "Your Steam session has expired, so owned games can't be hidden."), el("span", { class: "spacer" }),
        el("button", { class: "btn btn-sm", onclick: signInFromBrowse }, "Sign in again")),
    );
  } else if (a?.method === "guest") {
    host.append(
      el("div", { class: "banner info" }, el("span", { html: ICON.user }), el("span", {}, "Browsing as a guest. Sign in to hide games you already own."), el("span", { class: "spacer" }),
        el("button", { class: "btn btn-sm", onclick: signInFromBrowse }, "Sign in through Steam")),
    );
  } else if (state.error) {
    host.append(
      el("div", { class: "banner danger" }, el("span", { html: ICON.warning }), el("span", {}, `Steam didn't respond: ${state.error.message}`), el("span", { class: "spacer" }),
        el("button", { class: "btn btn-sm", onclick: () => loadAll({ force: true }) }, "Try again")),
    );
  }
}

// ----- For-you header: what the app learned from the library -----
function renderForYouHead() {
  const host = $("#foryou-head");
  if (!host) return;
  host.innerHTML = "";
  if (viewMode() !== "foryou") return;

  if (state.tasteLoading) {
    const p = state.tasteProgress;
    host.append(
      el("div", { class: "fy-head" },
        el("div", { class: "fy-title", html: ICON.sparkle }, el("span", {}, "Learning your taste")),
        el("div", { class: "muted" }, p?.total ? `Reading tags for ${fmtInt(p.done)} of ${fmtInt(p.total)} games you own…` : "Looking at your library and playtime…"),
        el("div", { class: "fy-bar" }, el("span", { style: { width: p?.total ? `${(p.done / p.total) * 100}%` : "15%" }, class: p?.total ? "" : "pulse" })),
      ),
    );
    return;
  }
  const t = state.taste;
  if (!t) {
    const msg =
      state.tasteReason === "session_expired" ? "Your Steam session expired. Sign in again to get personal picks."
      : state.tasteReason === "private" ? "Your Steam profile's Game details are private, so your library can't be read. Set them to Public in Steam's privacy settings, or sign in with your own API key, then rebuild."
      : state.tasteReason === "empty" ? "Your library looks empty, so there's nothing to learn from yet."
      : "Couldn't build a taste profile from your library.";
    host.append(el("div", { class: "fy-head" }, el("div", { class: "fy-title", html: ICON.warning }, el("span", {}, "No taste profile yet")), el("div", { class: "muted" }, msg),
      el("div", {}, el("button", { class: "btn btn-sm", onclick: state.tasteReason === "session_expired" ? signInFromBrowse : rebuildTaste }, state.tasteReason === "session_expired" ? "Sign in again" : "Try again"))));
    return;
  }
  const model = tasteModel();
  const phone = PHONE.matches;
  const shown = phone ? state.settings.showTastePhone === true : state.settings.showTaste !== false;
  const toggle = el("button", { class: "btn btn-ghost btn-sm", title: shown ? "Hide this panel" : "Show your taste profile", "aria-expanded": shown },
    shown ? "Hide" : "Show");
  toggle.addEventListener("click", () => {
    patchSettings(phone ? { showTastePhone: !shown } : { showTaste: !shown }, { persistNow: true });
    renderForYouHead();
  });
  const chips = (model?.topTags || []).map((id) => el("span", { class: "chip on" }, tagName(id)));
  const title = el("div", { class: "fy-title", html: ICON.sparkle }, el("span", {}, "Your taste"));

  if (!shown) {
    host.append(
      el("div", { class: "fy-head fy-collapsed" },
        el("div", { class: "fy-row" }, title,
          el("span", { class: "muted fy-basis" }, `${fmtInt(chips.length)} signature tags · learned from ${fmtInt(t.basedOn)} games${t.builtAt ? ` · updated ${timeAgo(t.builtAt)}` : ""}`),
          el("div", { class: "spacer" }), toggle)),
    );
    return;
  }
  const basis = `Learned from ${fmtInt(t.basedOn)} of your ${fmtInt(t.libraryCount)} games${t.hasPlaytime ? ", weighted by hours played" : ""}. It re-learns from your playtime every time the app refreshes.`;
  const top = (t.anchors || []).slice(0, 3).map((a) => (a.hours ? `${a.name} (${fmtInt(Math.round(a.hours))} h)` : a.name)).join(" · ");
  const lately = (t.anchors || []).filter((a) => a.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 3).map((a) => a.name).join(" · ");
  host.append(
    el("div", { class: "fy-head" },
      el("div", { class: "fy-row" }, title, el("div", { class: "spacer" }),
        el("button", { class: "btn btn-ghost btn-sm", title: "Re-read your library and playtime now", html: `${ICON.refresh}<span>Rebuild</span>`, onclick: rebuildTaste }),
        toggle),
      el("div", { class: "tags-wrap" }, chips.length ? chips : el("span", { class: "muted" }, "Not enough tagged games to find a pattern yet.")),
      el("div", { class: "muted fy-basis" }, basis, top ? ` Most played: ${top}.` : "", lately ? ` Lately: ${lately}.` : ""),
    ),
  );
}

function renderStats() {
  const host = $("#stats");
  if (!host) return;
  host.innerHTML = "";
  if (state.loading && !state.deals.length) {
    host.append(el("span", {}, "Scanning the Steam catalog…"));
    return;
  }
  const list = state.results;
  const saleOnly = state.settings.catalog !== "all";
  const best = list.reduce((m, d) => Math.max(m, d.discount), 0);
  const dot = () => el("span", { class: "dot" });
  host.append(el("span", {}, el("strong", {}, fmtInt(list.length)), saleOnly ? " deals" : " games"));
  if (state.ownedHidden) host.append(dot(), el("span", {}, el("strong", {}, fmtInt(state.ownedHidden)), " owned hidden"));
  if (saleOnly && best) host.append(dot(), el("span", {}, "best discount ", el("strong", {}, `${best}%`)));
  if (state.meta.total) {
    const what = saleOnly ? "discounted items" : "items on Steam";
    host.append(
      dot(),
      el("span", { class: "muted", title: `${fmtInt(state.deals.length)} of those are purchasable games (the rest are DLC, bundles, software, etc.)` },
        state.meta.streaming
          ? `scanning… ${fmtInt(state.meta.scanned)} of ${fmtInt(state.meta.total)} ${what}`
          : `scanned the ${fmtInt(state.meta.scanned)} most popular of ${fmtInt(state.meta.total)} ${what}`),
    );
  }
  const w = state.activeWeights || normWeights(state.settings.weights);
  const label = saleOnly
    ? `Score weights · ${Math.round(w.discount * 100)} discount / ${Math.round(w.rating * 100)} rating / ${Math.round(w.popularity * 100)} popularity`
    : `Score weights · ${Math.round(w.rating * 100)} rating / ${Math.round(w.popularity * 100)} popularity`;
  host.append(el("span", { class: "spacer" }), el("button", { class: "pill pill-info pill-btn", title: "Open settings to change the score weights", onclick: openSettings, html: ICON.settings }, el("span", {}, label)));
}

// ----- grid -----
function setupInfiniteScroll() {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) appendCards();
    },
    { root: $("#scroller"), rootMargin: "600px 0px" },
  );
  observer.observe($("#sentinel"));
}

function renderGrid(reset) {
  const grid = $("#grid");
  if (!grid) return;
  if (reset) {
    grid.innerHTML = "";
    state.shown = 0;
    if (!state.meta?.streaming) $("#scroller").scrollTop = 0; // keep the reader's place while pages stream in
  }
  if (state.loading && !state.deals.length) {
    for (let i = 0; i < 12; i++) grid.append(el("div", { class: "skeleton" }, el("div", { class: "sk sk-art" }), el("div", { class: "sk sk-line" }), el("div", { class: "sk sk-line short" })));
    return;
  }
  if (!state.results.length) {
    const strict = state.deals.length > 0;
    grid.append(
      el("div", { class: "empty", style: { gridColumn: "1 / -1" } },
        el("div", { class: "glyph", html: strict ? ICON.filter : ICON.sparkle }),
        el("h3", {}, strict ? "Nothing matches these filters" : state.error ? "Couldn't reach Steam" : "No deals found"),
        el("p", {}, strict ? "Try a lower minimum discount or rating, or clear your tags." : state.error ? state.error.message : "Steam's query returned nothing. Try refreshing in a moment."),
        strict ? el("button", { class: "btn", onclick: resetFilters }, "Reset filters") : el("button", { class: "btn", onclick: () => loadAll({ force: true }) }, "Refresh"),
      ),
    );
    return;
  }
  appendCards();
}

function appendCards() {
  const grid = $("#grid");
  if (!grid || state.shown >= state.results.length) return;
  const frag = document.createDocumentFragment();
  const end = Math.min(state.results.length, state.shown + PAGE);
  for (let i = state.shown; i < end; i++) frag.append(cardEl(state.results[i], i + 1));
  grid.append(frag);
  state.shown = end;
}

function ratingClass(r) {
  if (r == null) return "";
  return r >= 90 ? "rating-good" : r >= 80 ? "rating-ok" : "";
}

function imgEl(src, cls) {
  const img = el("img", { class: cls, alt: "", loading: "lazy", decoding: "async", src });
  img.addEventListener("load", () => img.classList.add("loaded"));
  img.addEventListener("error", () => { img.style.display = "none"; });
  return img;
}

function cardEl(d, rank) {
  const owned = state.library.owned.has(d.appid);
  const wished = state.library.wishlist.has(d.appid);
  const personal = state.personalized && d.match != null;
  const model = personal ? tasteModel() : null;
  const similar = model ? model.similar(d, 2) : [];
  const ring = personal
    ? el("div", { class: "ring match", style: { "--p": Math.round(d.match) }, title: `${Math.round(d.match)}% match · deal score ${d.score.toFixed(1)} · #${rank}` }, el("span", { class: "num" }, `${Math.round(d.match)}%`))
    : el("div", { class: "ring", style: { "--p": Math.round(d.score) }, title: `Score ${d.score.toFixed(1)} · #${rank}` }, el("span", { class: "num" }, Math.round(d.score)));
  // A div with button semantics, not a <button>: the card contains its own basket button, and
  // nested buttons are invalid HTML with inconsistent focus and scroll behaviour.
  const card = el(
    "div",
    { class: "card", role: "button", tabindex: 0, dataset: { appid: d.appid }, "aria-label": `${d.name}, ${d.discount}% off, ${d.price}` },
    el("div", { class: "card-art" },
      imgEl(d.image, ""),
      d.discount > 0 ? el("span", { class: "badge-discount num" }, `-${d.discount}%`) : null,
      ring,
      owned ? el("span", { class: "ribbon" }, "Owned") : null,
      wished ? el("span", { class: "heart", html: ICON.heart, title: "On your wishlist" }) : null,
    ),
    el("div", { class: "card-body" },
      el("div", { class: "card-title", title: d.name }, d.name),
      personal
        ? el("div", { class: "because", title: similar.map((x) => x.name).join(", ") },
            similar.length ? ["Because you played ", el("b", {}, similar.map((x) => x.name).join(" · "))] : ["Matches your taste in ", el("b", {}, (model.contributions(d).filter((c) => c.v > 0).slice(0, 2).map((c) => tagName(c.id)).join(" · ")) || "these tags")])
        : null,
      el("div", { class: "price-row" }, el("span", { class: "price num" }, d.price ?? "—"), d.discount > 0 && d.originalPrice ? el("span", { class: "price-orig num" }, d.originalPrice) : null, el("span", { class: "spacer" }), basketToggleEl(d)),
      el("div", { class: `rating-row ${ratingClass(d.rating)}` },
        el("span", { class: "pct num" }, d.rating != null ? `${d.rating}%` : "n/a"),
        d.reviewLabel ? el("span", { class: "lbl" }, d.reviewLabel) : null,
        el("span", { class: "muted num" }, `· ${fmtInt(d.reviews)}`),
        compatBadges(d, true),
      ),
      el("div", { class: "tag-row" }, d.tagids.slice(0, 3).map((t) => el("span", { class: "chip chip-sm" }, tagName(t)))),
    ),
  );
  card.addEventListener("click", () => openDrawer(d));
  card.addEventListener("keydown", (e) => {
    if (e.target !== card) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDrawer(d);
    }
  });
  return card;
}

/**
 * Steam Deck / Steam Machine ratings. On cards only "Verified" is shown (compact); the details panel
 * shows every rating Valve has published for the game.
 */
function compatBadges(d, compact) {
  const out = [];
  const add = (label, cat) => {
    if (compact && cat !== 3) return;
    if (!compact && !cat) return;
    const cls = cat === 3 ? "ok" : cat === 2 ? "mid" : "no";
    out.push(el("span", { class: `compat-badge ${cls} ${compact ? "compact" : ""}`, title: `${label}: ${Core.COMPAT_LABELS[cat]}` },
      compact ? `${label} ✓` : `${label} · ${Core.COMPAT_LABELS[cat]}`));
  };
  add("Deck", d.deck || 0);
  add("Machine", d.machine || 0);
  return out;
}

// "Why this is for you": top contributing tags and the owned games it resembles.
function whyBox(d) {
  if (!state.personalized || d.match == null) return null;
  const model = tasteModel();
  if (!model) return null;
  const contribs = model.contributions(d);
  const pos = contribs.filter((c) => c.v > 0).slice(0, 4);
  const neg = contribs.filter((c) => c.v < -0.02).slice(-2).reverse();
  const similar = model.similar(d, 3);
  return el("div", { class: "why-box" },
    el("div", { class: "score-head" }, el("span", { class: "muted" }, "Match with your taste"), el("span", { class: "big num match-color" }, `${Math.round(d.match)}%`)),
    pos.length ? el("div", { class: "why-row" }, el("span", { class: "muted" }, "You tend to play"), el("div", { class: "tags-wrap" }, pos.map((c) => el("span", { class: "chip on chip-sm" }, tagName(c.id))))) : null,
    neg.length ? el("div", { class: "why-row" }, el("span", { class: "muted" }, "Less your thing"), el("div", { class: "tags-wrap" }, neg.map((c) => el("span", { class: "chip chip-sm" }, tagName(c.id))))) : null,
    similar.length
      ? el("div", { class: "why-row" }, el("span", { class: "muted" }, "Similar to games you own"),
          el("div", { class: "why-similar" }, similar.map((x) => el("span", {}, el("b", {}, x.name), x.hours ? el("span", { class: "muted num" }, ` · ${fmtInt(Math.round(x.hours))} h`) : null))))
      : null,
  );
}

// ---------- basket ----------
const Core = window.SteamCore;
ICON.basket = svg('<path d="M3 10h18l-1.6 8.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8z"/><path d="m7 10 3-6"/><path d="m17 10-3-6"/><path d="M10 14v3"/><path d="M14 14v3"/>');
ICON.plus = svg('<path d="M12 5v14"/><path d="M5 12h14"/>');
ICON.check = svg('<path d="m5 12 5 5L20 7"/>');
ICON.trash = svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>');
ICON.copy = svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
ICON.undo = svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>');

const basket = () => (Array.isArray(state.settings.basket) ? state.settings.basket : []);
const inBasket = (appid) => basket().some((b) => b.appid === appid);
const fmtCents = (cents, sample) => {
  // Format like Steam does for this region: reuse the currency symbol from a real price string.
  const m = String(sample || "$0.00").match(/^([^\d\s]*)\s?[\d.,]+\s?([^\d\s]*)$/);
  const [pre, post] = m ? [m[1], m[2]] : ["$", ""];
  const n = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${pre}${n}${post}`;
};

function basketItem(d) {
  return { appid: d.appid, packageid: d.packageid ?? null, name: d.name, price: d.price, priceCents: d.priceCents ?? null, originalCents: d.originalCents ?? null, discount: d.discount || 0 };
}
function toggleBasket(d) {
  const list = basket().slice();
  const i = list.findIndex((b) => b.appid === d.appid);
  if (i >= 0) list.splice(i, 1);
  else {
    if (!d.packageid) toast("Steam doesn't sell this one as a single package, so it can't go in the cart. Open it on Steam instead.", { type: "err", timeout: 6000 });
    list.push(basketItem(d));
    toast(`Added to basket · ${fmtInt(list.length)} game${list.length === 1 ? "" : "s"}`, { type: "ok", timeout: 2500 });
  }
  patchSettings({ basket: list }, { persistNow: true });
  state.lastSent = null;
  renderBasketButton();
  refreshBasketToggles();
  if ($("#drawer").classList.contains("basket-open")) openBasket();
}
function removeFromBasket(appid) {
  patchSettings({ basket: basket().filter((b) => b.appid !== appid) }, { persistNow: true });
  state.lastSent = null;
  renderBasketButton();
  refreshBasketToggles();
  openBasket();
}
function clearBasket() {
  patchSettings({ basket: [] }, { persistNow: true });
  state.lastSent = null;
  renderBasketButton();
  refreshBasketToggles();
  openBasket();
}
// Preselect the tax region from the person's location (country + state/province from the connection).
// Runs once per session; a region the person chose by hand is never overwritten.
let geoChecked = false;
async function ensureTaxRegion() {
  if (geoChecked || !api.geo) return;
  geoChecked = true;
  const s = state.settings;
  if (s.taxRegion != null && !s.taxRegionAuto) return;
  const r = await api.geo.detect().catch(() => null);
  if (!r?.ok || !r.taxRegion) return;
  if (r.taxRegion !== s.taxRegion) {
    patchSettings({ taxRegion: r.taxRegion, taxRegionAuto: true }, { persistNow: true });
    if ($("#drawer").classList.contains("basket-open")) openBasket();
  }
}

function basketTotals() {
  const items = basket();
  const subtotal = items.reduce((s, b) => s + (b.priceCents || 0), 0);
  const original = items.reduce((s, b) => s + (b.originalCents || b.priceCents || 0), 0);
  const region = state.settings.taxRegion ?? Core.defaultTaxRegion(state.settings.country);
  const { rate, taxCents } = Core.estimateTax(subtotal, region, state.settings.taxCustomRate);
  return { items, subtotal, original, savings: Math.max(0, original - subtotal), region, rate, taxCents, total: subtotal + taxCents, sample: items.find((b) => b.price)?.price };
}

/** The small add/remove control used on cards and in the details panel. */
function basketToggleEl(d, { size = "sm", label = false } = {}) {
  const on = inBasket(d.appid);
  const b = el("button", {
    class: `btn btn-${size} basket-toggle ${on ? "on" : ""} ${label ? "" : "btn-icon"}`,
    dataset: { appid: d.appid },
    title: on ? "Remove from basket" : "Add to basket",
    "aria-label": on ? `Remove ${d.name} from basket` : `Add ${d.name} to basket`,
    "aria-pressed": on,
    html: (on ? ICON.check : ICON.plus) + (label ? `<span>${on ? "In basket" : "Add to basket"}</span>` : ""),
  });
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBasket(d);
  });
  return b;
}
function refreshBasketToggles() {
  for (const b of document.querySelectorAll(".basket-toggle")) {
    const on = inBasket(Number(b.dataset.appid));
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    b.title = on ? "Remove from basket" : "Add to basket";
    const hasLabel = Boolean(b.querySelector("span"));
    b.innerHTML = (on ? ICON.check : ICON.plus) + (hasLabel ? `<span>${on ? "In basket" : "Add to basket"}</span>` : "");
  }
}

function basketButtonEl() {
  const b = el("button", { class: "btn basket-btn", id: "basket-btn", title: "Your basket", "aria-label": "Basket" });
  b.addEventListener("click", openBasket);
  return b;
}
function renderBasketButton() {
  const b = $("#basket-btn");
  if (!b) return;
  const t = basketTotals();
  b.innerHTML = ICON.basket;
  b.classList.toggle("has-items", t.items.length > 0);
  if (t.items.length) {
    b.append(el("span", { class: "basket-count num" }, fmtInt(t.items.length)), el("span", { class: "basket-total num" }, fmtCents(t.subtotal, t.sample)));
  } else b.append(el("span", { class: "basket-label" }, "Basket"));
}

// ----- the basket panel (lives in the drawer) -----
function openBasket() {
  closeModal();
  const drawer = $("#drawer");
  drawer.innerHTML = "";
  drawer.classList.add("basket-open");
  const t = basketTotals();
  const s = state.settings;
  const needsRegion = t.region == null;

  const regionSelect = el("select", { class: "select", id: "tax-region", "aria-label": "Tax region" });
  regionSelect.append(el("option", { value: "", disabled: true, selected: needsRegion }, s.country === "CA" ? "Choose your province…" : "Choose your state…"));
  let group = null;
  for (const r of Core.TAX_REGIONS) {
    if (r.group && r.group !== group?.label) {
      group = el("optgroup", { label: r.group });
      regionSelect.append(group);
    }
    const opt = el("option", { value: r.code, selected: t.region === r.code }, r.rate != null && r.group ? `${r.name} · ${r.rate}%` : r.name);
    (r.group ? group : regionSelect).append(opt);
  }
  regionSelect.addEventListener("change", () => {
    patchSettings({ taxRegion: regionSelect.value, taxRegionAuto: false }, { persistNow: true });
    openBasket();
  });
  if (needsRegion) ensureTaxRegion();
  const regionName = Core.TAX_REGIONS.find((r) => r.code === t.region)?.name;
  const customRate = el("input", { class: "input num", type: "number", min: 0, max: 30, step: 0.001, value: s.taxCustomRate || "", placeholder: "%", style: { width: "90px" }, "aria-label": "Custom tax rate" });
  customRate.addEventListener("change", () => {
    patchSettings({ taxCustomRate: Number(customRate.value) || 0 }, { persistNow: true });
    openBasket();
  });

  const rows = t.items.map((b) =>
    el("div", { class: "basket-row" },
      el("img", { class: "basket-thumb", src: Core.headerImage(b.appid), alt: "", loading: "lazy" }),
      el("div", { class: "basket-info" },
        el("div", { class: "basket-name" }, b.name),
        el("div", { class: "basket-price-row" },
          b.discount > 0 ? el("span", { class: "badge-discount num basket-badge" }, `-${b.discount}%`) : null,
          el("span", { class: "price num" }, b.price ?? "—"),
          b.discount > 0 && b.originalCents ? el("span", { class: "price-orig num" }, fmtCents(b.originalCents, b.price)) : null,
          el("a", { class: "link basket-open-link", href: "#", onclick: (e) => { e.preventDefault(); api.openExternal(Core.storeUrl(b.appid)); } }, "Steam page"),
        ),
        (() => {
          const host = el("div", { class: "basket-sync", dataset: { cartBadge: b.appid } });
          const badge = cartBadge(b.appid);
          if (badge) host.append(badge);
          return host;
        })(),
      ),
      el("button", { class: "btn btn-icon btn-ghost", title: "Remove", "aria-label": `Remove ${b.name}`, html: ICON.close, onclick: () => removeFromBasket(b.appid) }),
    ),
  );

  const summary = t.items.length
    ? el("div", { class: "basket-summary" },
        el("div", { class: "sum-row" }, el("span", {}, `Subtotal · ${fmtInt(t.items.length)} game${t.items.length === 1 ? "" : "s"}`), el("span", { class: "num" }, fmtCents(t.subtotal, t.sample))),
        t.savings ? el("div", { class: "sum-row muted" }, el("span", {}, "You save"), el("span", { class: "num savings" }, fmtCents(t.savings, t.sample))) : null,
        el("div", { class: "sum-row tax-row" },
          el("div", { class: "tax-pick" },
            el("span", {}, t.region === "included" ? "Tax" : "Estimated tax", s.taxRegionAuto && !needsRegion ? el("span", { class: "chip chip-sm auto-chip", title: "Picked from your location. Change it if Steam bills you somewhere else." }, "auto") : null),
            regionSelect, t.region === "custom" ? customRate : null),
          el("span", { class: "num" }, t.region === "included" ? "included" : needsRegion ? "—" : fmtCents(t.taxCents, t.sample)),
        ),
        el("div", { class: "sum-row total" }, el("span", {}, needsRegion ? "Total before tax" : "Estimated total"), el("span", { class: "num" }, fmtCents(t.total, t.sample))),
        el("div", { class: "muted tax-note" },
          t.region === "included" ? `Steam prices ${s.taxRegionAuto ? "where you are" : "in your region"} already include tax, so this total should match checkout.`
          : needsRegion ? "Steam adds sales tax at checkout based on your billing address. Pick your region above for an estimate."
          : `${s.taxRegionAuto && regionName ? `Looks like you're in ${regionName}. ` : ""}Estimate only: local taxes and digital-goods rules vary. Steam's checkout shows the exact amount before you pay.`),
      )
    : null;

  drawer.append(
    el("div", { class: "basket-head" },
      el("div", { class: "fy-title", html: ICON.basket }, el("span", {}, "Your basket")),
      el("div", { class: "spacer" }),
      t.items.length ? el("button", { class: "btn btn-ghost btn-sm", html: `${ICON.trash}<span>Clear</span>`, onclick: clearBasket }) : null,
      el("button", { class: "btn btn-icon btn-ghost", "aria-label": "Close", html: ICON.close, onclick: closeDrawer }),
    ),
    el("div", { class: "drawer-body basket-body" },
      t.items.length ? el("div", { class: "basket-list" }, rows) : el("div", { class: "empty basket-empty" }, el("div", { class: "glyph", html: ICON.basket }), el("h3", {}, "Your basket is empty"), el("p", {}, "Use the + on any game to collect sales here and see what they add up to before you check out on Steam.")),
      summary,
      t.items.length ? sendPanel(t) : api.platform === "web" && !api.pair?.isPaired() ? el("div", { class: "send-box" }, appPromo(t)) : null,
      api.cart?.mode === "direct" && api.pair?.start ? pairRow() : null,
    ),
  );
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
  $("#scrim").onclick = () => { closeDrawer(); closeModal(); };
  drawer.scrollTop = 0;
}

const appendKids = (parent, ...kids) => parent.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const STEAM_CART_URL = "https://store.steampowered.com/cart/";
const APP_DOWNLOAD_URL = "https://github.com/Drakey83/steam-deals/releases/latest/download/Steam-Deals-Setup.exe";
const appPageUrl = () => (api.platform === "web" ? "/app" : "https://steamdeal.vercel.app/app");
const isPhoneDevice = () => api.device === "ios" || api.device === "android";

function openCartButtons(primary = false) {
  const phone = isPhoneDevice();
  return el("div", { class: "btn-row" },
    el("button", { class: `btn btn-sm ${primary ? "btn-primary" : ""}`, html: `${ICON.play}<span>Open my Steam cart</span>`, onclick: () => api.openExternal(phone ? STEAM_CART_URL : `steam://openurl/${STEAM_CART_URL}`) }),
    el("button", { class: "btn btn-sm", html: `${ICON.external}<span>Cart in browser</span>`, onclick: () => api.openExternal(STEAM_CART_URL) }),
  );
}

/** Is a Steam cart being kept in step with this basket right now (by this app, or by the paired PC)? */
function syncActive() {
  if (api.platform === "web") return Boolean(api.pair?.isPaired());
  return state.settings.pairAutoCart !== false && state.account?.method === "steam";
}

/** Per-game cart state, as reported by whoever talks to Steam (this app, or the paired PC). */
function cartBadge(appid) {
  if (!syncActive()) return null;
  const st = state.sync?.status?.[appid];
  const web = api.platform === "web";
  const L = {
    added: ["In your Steam cart", "ok", ICON.check],
    owned: ["Already owned", "ok", ICON.check],
    failed: ["Steam didn't take it", "err", ICON.warning],
    no_package: ["Not sold on its own", "warn", ICON.warning],
    needs_steam: [web ? "Waiting for Steam sign-in on your PC" : "Sign in through Steam to add it", "warn", ICON.warning],
    removed_on_steam: ["Taken out of the cart on Steam", "warn", ICON.warning],
  };
  const waiting = web && !state.sync?.pcOnline ? "Waiting for your PC" : "Adding to your Steam cart…";
  const [label, cls, icon] = st && L[st.s] ? L[st.s] : [waiting, "wait", ICON.sync];
  return el("span", { class: `cart-badge ${cls}`, title: st?.msg || "", html: icon }, el("span", {}, label));
}

function durationText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 2) return "a minute";
  if (m < 60) return `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.round(h / 24)} days`;
}

/** One line that says how the sync is doing. Re-rendered in place when a status event arrives. */
function syncLine() {
  const line = el("div", { class: "sync-line muted small", id: "sync-line" });
  const s = state.sync || {};
  if (api.platform === "web") {
    if (!s.paired) return line;
    if (!s.at) line.textContent = "Checking in with your PC…";
    else if (s.pcOnline && s.pcok) line.textContent = `Your PC is connected${s.subtotal ? ` · Steam cart subtotal ${s.subtotal}` : ""}`;
    else if (s.pcOnline) line.textContent = "Your PC's app is running, but it isn't signed in through Steam or syncing is switched off there, so nothing reaches the cart yet.";
    else if (s.pcSeenAgo == null) line.textContent = "Looking for your PC… Open Steam Deals there (it can sit in the tray). It checks in within half a minute.";
    else line.textContent = `Your PC hasn't checked in for ${durationText(s.pcSeenAgo)}. Your basket is saved; it syncs the moment Steam Deals is running there again.`;
    return line;
  }
  if (s.paused) line.textContent = "Syncing with your phone is paused (tray menu). Changes made there wait until you resume.";
  else if (s.lastError) line.textContent = `Last sync problem: ${s.lastError}`;
  else if (s.paired && s.lastPoll) line.textContent = `Shared with your phone · checked ${timeAgo(s.lastPoll)}${s.subtotal ? ` · Steam cart subtotal ${s.subtotal}` : ""}`;
  else if (s.subtotal) line.textContent = `Steam cart subtotal ${s.subtotal}`;
  return line;
}

function sendPanel(t) {
  const direct = api.cart?.mode === "direct";
  const ids = t.items.map((b) => b.packageid).filter(Boolean);
  const missing = t.items.length - ids.length;
  const box = el("div", { class: "send-box" });
  const missingNote = missing
    ? el("div", { class: "muted small" }, `${fmtInt(missing)} game${missing === 1 ? " isn't" : "s aren't"} sold as a single package, so Steam's cart can't take ${missing === 1 ? "it" : "them"}. Use ${missing === 1 ? "its" : "their"} Steam page.`)
    : null;

  if (direct) {
    const steamAccount = state.account?.method === "steam";
    if (!steamAccount) {
      appendKids(box,
        el("div", { class: "send-title" }, "Ready to buy?"),
        el("div", { class: "muted" }, "Sign in through Steam (account menu, top right) and this app keeps your Steam cart filled with exactly these games. Nothing is purchased until you check out in Steam."),
        el("button", { class: "btn btn-primary", html: `${ICON.login}<span>Sign in through Steam</span>`, onclick: signInFromBrowse }),
      );
      return box;
    }
    if (state.settings.pairAutoCart !== false) {
      appendKids(box,
        el("div", { class: "send-title ok", html: ICON.sync }, el("span", {}, "Synced with your Steam cart")),
        el("div", { class: "muted" }, `Everything in this basket is put into your Steam cart for you, and taken out again if you remove it here${state.sync?.paired ? " or on your phone" : ""}. Nothing is purchased: you review and pay in Steam's own checkout.`),
        syncLine(),
        openCartButtons(true),
        el("div", { class: "btn-row" },
          el("button", { class: "btn btn-ghost btn-sm", html: `${ICON.refresh}<span>Check now</span>`, onclick: () => api.sync?.now() }),
          el("button", { class: "btn btn-ghost btn-sm", onclick: () => { patchSettings({ pairAutoCart: false }, { persistNow: true }); openBasket(); } }, "Switch to a Send button"),
        ),
        missingNote,
      );
      return box;
    }
    // Manual mode: the person switched automatic syncing off.
    if (state.lastSent) {
      const ls = state.lastSent;
      appendKids(box,
        el("div", { class: "send-title ok", html: ICON.check }, el("span", {}, ls.count ? `Sent ${fmtInt(ls.count)} game${ls.count === 1 ? "" : "s"} to your Steam cart` : "Already in your Steam cart")),
        ls.subtotal ? el("div", { class: "muted" }, `Steam's cart subtotal: ${ls.subtotal}. Review and pay on Steam as usual.`) : null,
        openCartButtons(),
        ls.added?.length ? el("button", { class: "btn btn-ghost btn-sm", html: `${ICON.undo}<span>Undo: remove them from my Steam cart</span>`, onclick: undoSend }) : null,
      );
      return box;
    }
    const sendBtn = el("button", { class: "btn btn-primary", disabled: !ids.length, html: `${ICON.basket}<span>Send to my Steam cart</span>` });
    sendBtn.addEventListener("click", () => sendDirect(ids, sendBtn));
    appendKids(box,
      el("div", { class: "send-title" }, "Ready to buy?"),
      el("div", { class: "muted" }, "One click puts these in your Steam cart. Nothing is purchased: you check out in Steam as usual."),
      sendBtn,
      el("button", { class: "btn btn-ghost btn-sm", onclick: () => { patchSettings({ pairAutoCart: true }, { persistNow: true }); api.sync?.now(); openBasket(); } }, "Sync automatically instead"),
      missingNote,
    );
    return box;
  }

  // Website. Paired with the Windows app: the basket is the Steam cart, live. Otherwise: each game opens in
  // Steam with its own Add to Cart button, and an explanation of what the Windows app adds.
  if (api.pair?.isPaired()) {
    appendKids(box,
      el("div", { class: "send-title ok", html: ICON.sync }, el("span", {}, "Synced with your PC's Steam cart")),
      el("div", { class: "muted" }, isPhoneDevice()
        ? "The Steam Deals app on your PC puts everything here into your Steam cart and takes out what you remove. The cart belongs to your account, so you can check out right here in the Steam app, or on the PC."
        : "The Steam Deals app on your PC puts everything here into your Steam cart and takes out what you remove. Check out in Steam whenever you're ready."),
      syncLine(),
      openCartButtons(true),
      missingNote,
      el("details", { class: "shortcut" }, el("summary", {}, "Open each game in Steam instead"), perGameList(t)),
      el("div", { class: "muted small" }, "Paired with your PC. ", el("a", { class: "link", href: "#", onclick: (e) => { e.preventDefault(); unpairHere(); } }, "Unpair this device")),
    );
    return box;
  }
  appendKids(box, el("div", { class: "send-title" }, "Add to your Steam cart"), perGameList(t), missingNote);
  box.append(appPromo(t));
  return box;
}

/** Website, not paired: what the Windows app adds, where to get it, and the pairing-code field. */
function appPromo(t) {
  const phone = isPhoneDevice();
  const windows = api.device === "windows";
  const box = el("div", { class: "faster app-promo" },
    el("div", { class: "send-title", html: ICON.monitor }, el("span", {}, "Let your Windows PC do it for you")),
    el("div", { class: "muted" }, phone
      ? "The free Steam Deals Windows app is the bridge between this phone and Steam. Pair once, and this basket becomes your Steam cart, live: add or remove games here and they appear in or leave the cart within seconds, then pay in the Steam app or on the PC."
      : "The free Steam Deals Windows app is the bridge between this browser and Steam. Pair once, and this basket becomes your Steam cart, live: add or remove games here and they appear in or leave the cart within seconds."),
    el("ul", { class: "promo-list muted" },
      el("li", {}, "No send button and no codes to copy each time: it just stays in sync."),
      el("li", {}, "Works from anywhere, mobile data included. The PC only needs to be on, with the app in its tray."),
      el("li", {}, "Never buys anything. Checkout always happens in Steam."),
      el("li", {}, "Shares only a random pairing key and game ids, never account details."),
    ),
    el("div", { class: "btn-row" },
      phone
        ? el("a", { class: "btn btn-sm btn-primary", href: appPageUrl(), target: "_blank", rel: "noopener", html: `${ICON.monitor}<span>Get the Windows app</span>` })
        : el("a", { class: "btn btn-sm btn-primary", href: APP_DOWNLOAD_URL, html: `${ICON.download}<span>Download for Windows</span>` }),
      el("a", { class: "btn btn-sm", href: appPageUrl(), target: "_blank", rel: "noopener", html: `${ICON.external}<span>How it works</span>` }),
    ),
    el("div", { class: "muted small" }, phone ? "Install it on your PC (Windows 10 or 11, about 110 MB); the page explains everything." : "Windows 10 or 11, about 110 MB, free and open source."),
  );
  const codeInput = el("input", { class: "input code-input", type: "text", maxlength: 7, placeholder: "ABC123", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", "aria-label": "Pairing code" });
  const pairBtn = el("button", { class: "btn btn-primary btn-sm" }, "Pair");
  const pairNow = async () => {
    const code = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) return toast("A pairing code is 6 letters and numbers.", { type: "err" });
    pairBtn.disabled = true;
    const r = await api.pair.claim(code);
    pairBtn.disabled = false;
    if (!r.ok) return toast(r.error.message, { type: "err", timeout: 7000 });
    toast("Paired. This basket now syncs with your PC.", { type: "ok" });
    api.sync?.status().then((s) => { if (s.ok) state.sync = s; openBasket(); });
  };
  pairBtn.addEventListener("click", pairNow);
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") pairNow(); });
  codeInput.addEventListener("input", () => { codeInput.value = codeInput.value.toUpperCase(); });
  box.append(
    el("div", { class: "pair-have" },
      el("div", { class: "muted small" }, el("b", {}, "Already have it?"), " In the app on your PC, open the basket and press “Pair a phone or browser”, then type the code it shows:"),
      el("div", { class: "btn-row" }, codeInput, pairBtn),
    ),
  );
  if (windows && t.items.length) {
    box.append(el("div", { class: "muted small" }, "Installed on this PC? ", el("a", { class: "link", href: "#", onclick: (e) => { e.preventDefault(); location.href = api.cart.appLink(t.items); } }, "Open this basket in the app"), "."));
  }
  return box;
}

async function unpairHere() {
  await api.pair.unpair();
  state.sync = { paired: false, status: {} };
  toast("Unpaired. Your basket stays in this browser.", { type: "ok" });
  openBasket();
}

/** One "Open in Steam" button per basket game, with progress, then "Open my Steam cart". */
function perGameList(t) {
  const phone = isPhoneDevice();
  const inSteam = (appid) => (phone ? `https://store.steampowered.com/app/${appid}/` : `steam://store/${appid}`);
  const cartInSteam = phone ? STEAM_CART_URL : `steam://openurl/${STEAM_CART_URL}`;
  const opened = (state.openedInSteam ||= new Set());
  const progress = el("div", { class: "muted small" });
  const renderProgress = () => {
    const n = t.items.filter((b) => opened.has(b.appid)).length;
    progress.textContent = n ? `${fmtInt(n)} of ${fmtInt(t.items.length)} opened in Steam` : "";
  };
  const rows = t.items.map((b) => {
    const done = opened.has(b.appid);
    const btn = el("button", { class: "btn btn-sm", html: `${done ? ICON.check : ICON.play}<span>${done ? "Opened" : "Open in Steam"}</span>` });
    const row = el("div", { class: `steam-row ${done ? "done" : ""}` },
      el("img", { class: "basket-thumb small", src: Core.headerImage(b.appid), alt: "", loading: "lazy" }),
      el("div", { class: "basket-info" }, el("div", { class: "basket-name" }, b.name), el("div", { class: "muted small num" }, b.price ?? "")),
      btn);
    btn.addEventListener("click", () => {
      api.openExternal(inSteam(b.appid));
      opened.add(b.appid);
      row.classList.add("done");
      btn.innerHTML = `${ICON.check}<span>Opened</span>`;
      renderProgress();
    });
    return row;
  });
  renderProgress();
  return el("div", { class: "per-game" },
    el("div", { class: "muted small" }, "Each button opens the game in Steam with its Add to Cart button ready. Then open your cart to pay."),
    el("div", { class: "steam-list" }, rows),
    progress,
    el("div", { class: "btn-row" },
      el("button", { class: "btn btn-sm", html: `${ICON.basket}<span>Open my Steam cart</span>`, onclick: () => api.openExternal(cartInSteam) }),
      !phone ? el("button", { class: "btn btn-sm", html: `${ICON.external}<span>Cart in browser</span>`, onclick: () => api.openExternal(STEAM_CART_URL) }) : null,
    ),
  );
}

// ---------- desktop: pairing phones and browsers to this app's basket ----------
function pairRow() {
  const host = el("div", { class: "import-row", id: "pair-row" });
  const render = (st) => {
    host.innerHTML = "";
    if (!st.paired) {
      host.append(
        el("div", {}, el("b", {}, "Shop on your phone, pay anywhere."), " Pair a phone or any browser with this app and you share one basket: whatever you add there lands in your Steam cart within seconds, as long as this PC is on."),
        el("div", { class: "btn-row" }, el("button", { class: "btn btn-sm btn-primary", html: `${ICON.phone}<span>Pair a phone or browser</span>`, onclick: openPairDialog })),
      );
      return;
    }
    host.append(
      el("div", {}, el("b", {}, "Paired."), ` This basket is shared with your phone and any browser you paired, and this app keeps your Steam cart matching it${state.settings.closeToTray !== false ? ", even from the tray" : ""}.`),
      el("div", { class: "btn-row" },
        el("button", { class: "btn btn-sm", html: `${ICON.phone}<span>Pair another device</span>`, onclick: openPairDialog }),
        el("button", { class: "btn btn-sm btn-ghost", onclick: async () => { await api.pair.unpair(); state.sync = { ...(state.sync || {}), paired: false }; toast("Unpaired. Your basket stays here.", { type: "ok" }); openBasket(); } }, "Unpair all devices"),
      ),
      el("div", { class: "muted small" }, "Closing the window keeps Steam Deals syncing from the tray. Settings has “Start with Windows” so the PC is always ready."),
    );
  };
  render(state.sync || {});
  api.pair.status().then((r) => {
    if (!r.ok) return;
    state.sync = { ...(state.sync || {}), ...(r.sync || {}), paired: r.paired, status: r.sync?.cart?.status || state.sync?.status || {}, subtotal: r.sync?.cart?.subtotal ?? state.sync?.subtotal ?? null };
    render(state.sync);
  });
  return host;
}

function openPairDialog() {
  closeDrawer();
  const modal = $("#modal");
  modal.innerHTML = "";
  let cancelled = false;
  let timer = null;
  const close = () => { cancelled = true; clearTimeout(timer); closeModal(); };
  const body = el("div", { class: "connect-body" });
  const status = el("div", { class: "muted connect-status", "aria-live": "polite" }, "Getting a pairing code…");
  modal.append(
    el("div", { class: "modal-head" }, el("h2", {}, "Pair a phone or browser"), el("button", { class: "btn btn-icon btn-ghost", "aria-label": "Close", html: ICON.close, onclick: close })),
    el("div", { class: "modal-body" }, body, status,
      el("div", { class: "muted small" }, "Pairing shares a random key between this app and the other device, and the basket itself: game ids, names and prices. No account details. You can unpair from the basket at any time.")),
  );
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
  $("#scrim").onclick = close;
  const start = async () => {
    body.innerHTML = "";
    const r = await api.pair.start();
    if (cancelled) return;
    if (!r.ok) { status.textContent = r.error.message; body.append(el("button", { class: "btn", onclick: start }, "Try again")); return; }
    body.append(
      el("div", { class: "code-row" }, el("span", { class: "code num" }, r.code)),
      el("ol", { class: "steps" },
        el("li", {}, "On your phone or in any browser, open ", el("b", {}, "steamdeal.vercel.app"), " and open the basket (the + on any game puts something in it)."),
        el("li", {}, "Under “Already have it?”, type this code."),
      ),
      el("div", { class: "muted small" }, "After that the basket is shared: add or remove games on either side and this app keeps your Steam cart matching, as long as this PC is on. Turn on “Start with Windows” in Settings so it always is."),
    );
    status.textContent = "Waiting for the other device… (code lasts 10 minutes)";
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      const c = await api.pair.check(r.pairId);
      if (cancelled) return;
      if (c.ok && c.claimed) {
        status.textContent = "Paired!";
        toast("Paired. The basket is now shared.", { type: "ok" });
        api.pair.status().then((st) => { if (st.ok) state.sync = { ...(state.sync || {}), ...(st.sync || {}), paired: true }; });
        setTimeout(() => { close(); openBasket(); }, 800);
        return;
      }
      if ((c.ok && c.expired) || Date.now() - started > 10 * 60 * 1000) {
        status.textContent = "That code expired.";
        body.innerHTML = "";
        body.append(el("button", { class: "btn btn-primary", onclick: start }, "Get a new code"));
        return;
      }
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
  };
  start();
}

/** The shared basket changed somewhere else (phone, PC, or a merge after pairing). */
function onBasketReplaced({ items, source } = {}) {
  const before = basket().length;
  state.settings = { ...state.settings, basket: Array.isArray(items) ? items : [] };
  state.lastSent = null;
  renderBasketButton();
  refreshBasketToggles();
  if ($("#drawer").classList.contains("basket-open")) openBasket();
  if (source !== "remote") return;
  const after = basket().length;
  const from = api.platform === "web" ? "your PC" : "your phone";
  const msg = after > before ? `${fmtInt(after - before)} game${after - before === 1 ? "" : "s"} added from ${from}`
    : after < before ? `${fmtInt(before - after)} game${before - after === 1 ? "" : "s"} removed from ${from}`
    : `Basket updated from ${from}`;
  toast(msg, { type: "ok", timeout: 4000 });
}

/** Cart status arrived (per-game "in your Steam cart", PC online, and so on): refresh in place. */
function onCartStatus(st) {
  state.sync = { ...(state.sync || {}), ...(st || {}) };
  if (!$("#drawer").classList.contains("basket-open")) return;
  for (const b of basket()) {
    const host = document.querySelector(`[data-cart-badge="${b.appid}"]`);
    if (!host) continue;
    host.innerHTML = "";
    const badge = cartBadge(b.appid);
    if (badge) host.append(badge);
  }
  $("#sync-line")?.replaceWith(syncLine());
}

/** Add games that arrived from the website through a steamdeals:// link. */
async function receiveBasket(items, source) {
  const wanted = (items || []).map((i) => ({ appid: Number(i.appid), packageid: Number(i.packageid) || null })).filter((i) => i.appid > 0);
  if (!wanted.length) return;
  const byApp = new Map(state.deals.map((d) => [d.appid, d]));
  const missing = wanted.filter((i) => !byApp.has(i.appid)).map((i) => i.appid);
  if (missing.length && api.items?.lookup) {
    const r = await api.items.lookup(missing);
    if (r.ok) for (const d of r.items || []) byApp.set(d.appid, d);
  }
  const list = basket().slice();
  let added = 0;
  for (const i of wanted) {
    if (list.some((b) => b.appid === i.appid)) continue;
    const d = byApp.get(i.appid);
    if (!d) continue;
    list.push(basketItem({ ...d, packageid: d.packageid ?? i.packageid }));
    added++;
  }
  patchSettings({ basket: list }, { persistNow: true });
  state.lastSent = null;
  renderBasketButton();
  refreshBasketToggles();
  if ($("#grid")) openBasket();
  const from = source === "phone" ? "your phone" : "the website";
  toast(added ? `${fmtInt(added)} game${added === 1 ? "" : "s"} added from ${from}` : `Those games from ${from} are already in your basket`, { type: "ok", timeout: 5000 });
}

async function sendDirect(ids, btn) {
  btn.disabled = true;
  btn.innerHTML = `${ICON.basket}<span>Sending…</span>`;
  const r = await api.cart.add({ packageids: ids });
  if (!r.ok) {
    btn.disabled = false;
    btn.innerHTML = `${ICON.basket}<span>Send to my Steam cart</span>`;
    if (r.error.code === "session_expired" || r.error.code === "needs_steam") {
      toast(r.error.message, { type: "err", action: signInFromBrowse, actionLabel: "Sign in", timeout: 8000 });
    } else toast(r.error.message, { type: "err", timeout: 7000 });
    return;
  }
  state.lastSent = { count: r.added?.length || ids.length, added: r.added || [], subtotal: r.cart?.subtotal || null };
  toast(`${fmtInt(state.lastSent.count)} game${state.lastSent.count === 1 ? "" : "s"} added to your Steam cart`, { type: "ok" });
  openBasket();
}
async function undoSend() {
  const ls = state.lastSent;
  if (!ls?.added?.length) return;
  const r = await api.cart.remove({ lineItemIds: ls.added });
  if (!r.ok) return toast(r.error.message, { type: "err" });
  state.lastSent = null;
  toast("Removed from your Steam cart. Your basket here is unchanged.", { type: "ok" });
  openBasket();
}

// ---------- drawer ----------
function openDrawer(d) {
  state.selected = d;
  const drawer = $("#drawer");
  drawer.innerHTML = "";
  drawer.classList.remove("basket-open");
  const owned = state.library.owned.has(d.appid);
  const wished = state.library.wishlist.has(d.appid);
  const parts = d.parts || { discount: 0, rating: 0, popularity: 0 };
  const w = normWeights(state.settings.weights);
  const pct = (x) => `${Math.max(0, Math.min(100, x))}%`;

  drawer.append(
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
          basketToggleEl(d, { size: "sm", label: true }),
          el("button", { class: "btn btn-sm", html: `${ICON.external}<span>Open on Steam</span>`, onclick: () => api.openExternal(d.url) }),
          el("button", { class: "btn btn-sm", title: "Open in the Steam app", html: `${ICON.play}<span>Steam app</span>`, onclick: () => api.openExternal(`steam://store/${d.appid}`) }),
        ),
      ),
      el("div", { class: "score-box" },
        el("div", { class: "score-head" }, el("span", { class: "muted" }, "Deal score"), el("span", { class: "big num" }, d.score != null ? d.score.toFixed(1) : "—")),
        el("div", { class: "score-bar" },
          el("span", { class: "s-d", style: { width: pct(parts.discount) } }),
          el("span", { class: "s-r", style: { width: pct(parts.rating) } }),
          el("span", { class: "s-p", style: { width: pct(parts.popularity) } }),
        ),
        el("div", { class: "legend" },
          el("span", {}, el("i", { style: { background: "var(--green)" } }), `Discount ${d.discount}% × ${Math.round(w.discount * 100)}% = ${parts.discount.toFixed(1)}`),
          el("span", {}, el("i", { style: { background: "var(--accent)" } }), `Rating ${d.rating ?? 0}% × ${Math.round(w.rating * 100)}% = ${parts.rating.toFixed(1)}`),
          el("span", {}, el("i", { style: { background: "var(--pink)" } }), `Popularity ${Math.round(d.popularity ?? 0)} × ${Math.round(w.popularity * 100)}% = ${parts.popularity.toFixed(1)}`),
        ),
      ),
      el("div", { class: `rating-row ${ratingClass(d.rating)}`, style: { fontSize: "13.5px" } },
        el("span", { class: "pct num" }, d.rating != null ? `${d.rating}% positive` : "No rating yet"),
        d.reviewLabel ? el("span", { class: "lbl" }, `· ${d.reviewLabel}`) : null,
        el("span", { class: "muted num" }, `· ${fmtInt(d.reviews)} reviews`),
      ),
      whyBox(d),
      el("div", { class: "tags-wrap" }, d.tagids.map((t) => el("span", { class: "chip" }, tagName(t)))),
      d.description ? el("p", { class: "desc" }, d.description) : null,
    ),
  );
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
  $("#scrim").onclick = () => { closeDrawer(); closeModal(); };
  drawer.scrollTop = 0;
}
function closeDrawer() {
  const drawer = $("#drawer");
  drawer.classList.remove("open", "basket-open");
  drawer.setAttribute("aria-hidden", "true");
  if (!$("#modal").classList.contains("open")) $("#scrim").classList.remove("open");
  state.selected = null;
}

// ---------- settings modal ----------
function openSettings() {
  closeDrawer();
  const s = state.settings;
  const modal = $("#modal");
  modal.innerHTML = "";

  const select = (key, options, onChange) => {
    const sel = el("select", { class: "select" }, options.map(([v, l]) => el("option", { value: v, selected: String(s[key]) === String(v) }, l)));
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  };
  const weights = { ...s.weights };
  const weightRow = (key, label) => {
    const val = el("span", { class: "val num" }, `${Math.round(normWeights(weights)[key] * 100)}%`);
    const input = el("input", { type: "range", min: 0, max: 100, step: 5, value: weights[key] });
    input.addEventListener("input", () => {
      weights[key] = Number(input.value);
      const n = normWeights(weights);
      for (const k of Object.keys(n)) {
        const v = modal.querySelector(`[data-weight="${k}"]`);
        if (v) v.textContent = `${Math.round(n[k] * 100)}%`;
      }
      patchSettings({ weights: { ...weights } });
      renderStats();
    });
    val.dataset.weight = key;
    return el("div", { class: "weight" }, el("span", {}, label), input, val);
  };

  const toggleRow = (label, key, def, help) => {
    const input = el("input", { type: "checkbox", checked: s[key] ?? def });
    input.addEventListener("change", () => {
      patchSettings({ [key]: input.checked }, { persistNow: true });
      if (key === "pairAutoCart" && input.checked) api.sync?.now();
    });
    return el("div", { class: "row row-toggle" },
      el("div", { class: "row-text" }, el("div", {}, label), help ? el("div", { class: "muted", style: { fontSize: "12.5px" } }, help) : el("span")),
      el("label", { class: "toggle" }, input, el("span", { class: "switch" })));
  };

  const a = state.account;
  const accountRow = a && a.method !== "guest"
    ? el("div", { class: "row" }, el("div", { style: { display: "flex", gap: "10px", alignItems: "center" } }, avatarEl(a), el("div", {}, el("div", { style: { fontWeight: 600 } }, a.name), el("div", { class: "muted", style: { fontSize: "12px" } }, a.method === "steam" ? "Signed in through Steam" : "Steam Web API key"))),
        el("button", { class: "btn btn-sm btn-danger", onclick: signOut }, "Sign out"))
    : el("div", { class: "row" }, el("span", { class: "muted" }, "Not signed in. Owned games can't be hidden."), el("button", { class: "btn btn-sm", onclick: signInFromBrowse }, "Sign in through Steam"));

  modal.append(
    el("div", { class: "modal-head" }, el("h2", {}, "Settings"), el("button", { class: "btn btn-icon btn-ghost", "aria-label": "Close", html: ICON.close, onclick: closeModal })),
    el("div", { class: "modal-body" },
      el("div", { class: "settings-group" }, el("h3", {}, "Store"),
        el("div", { class: "row" }, el("span", {}, "Region (prices and currency)"), select("country", COUNTRIES, (v) => patchSettings({ country: v }, { refetch: true, persistNow: true }))),
        el("div", { class: "row" }, el("span", {}, "Language"), select("language", LANGUAGES, (v) => patchSettings({ language: v }, { refetch: true, persistNow: true }))),
        el("div", { class: "row" }, el("span", {}, "Scan depth"), select("scanDepth", SCAN_DEPTHS, (v) => { patchSettings({ scanDepth: Number(v) }, { refetch: true, persistNow: true }); renderSidebar(); })),
      ),
      el("div", { class: "settings-group" }, el("h3", {}, "Score weights"),
        el("div", { class: "weights" }, weightRow("discount", "Discount depth"), weightRow("rating", "Review rating"), weightRow("popularity", "Popularity")),
        el("div", { class: "muted", style: { fontSize: "12.5px" } }, "Popularity is the review count on a log scale, relative to the most-reviewed game in your current results."),
      ),
      el("div", { class: "settings-group" }, el("h3", {}, "For you"),
        (() => {
          const val = el("span", { class: "val num" }, `${s.personalWeight ?? 60}%`);
          const input = el("input", { type: "range", min: 0, max: 100, step: 5, value: s.personalWeight ?? 60 });
          input.addEventListener("input", () => {
            val.textContent = `${input.value}%`;
            patchSettings({ personalWeight: Number(input.value) });
          });
          return el("div", { class: "weights" }, el("div", { class: "weight" }, el("span", {}, "Taste over deal"), input, val));
        })(),
        el("div", { class: "muted", style: { fontSize: "12.5px" } }, "How much the For-you ranking favours games that match your library over games that are simply the best bargains. 100% is pure taste match; 0% is the plain deal score."),
      ),
      el("div", { class: "settings-group" }, el("h3", {}, "Account"), accountRow),
      api.platform === "web"
        ? el("div", { class: "settings-group" }, el("h3", {}, "Windows app"),
            el("div", { class: "muted", style: { fontSize: "13px" } },
              "The free Steam Deals Windows app does everything this site does and adds the one thing a browser can't: it fills your Steam cart. Pair this browser with it (basket → “Already have it?”) and your basket becomes your Steam cart, live, from anywhere. ",
              el("a", { class: "link", href: "/app", target: "_blank", rel: "noopener" }, "How it works and download"), "."))
        : el("div", { class: "settings-group" }, el("h3", {}, "Windows app"),
            toggleRow("Keep my Steam cart in sync with the basket", "pairAutoCart", true, "Adds what you put in the basket, here or on a paired phone, to your Steam cart and removes what you take out. It never buys anything."),
            toggleRow("Close to the tray instead of quitting", "closeToTray", true, "The X button hides Steam Deals next to the clock so syncing keeps running. Quit from the tray menu."),
            toggleRow("Start with Windows", "startWithWindows", false, "Starts hidden in the tray when you sign in to Windows, so your PC is always ready for your phone.")),
      el("div", { class: "settings-group" }, el("h3", {}, "About"),
        el("div", { class: "about", id: "about" }, api.platform === "web"
          ? "Steam Deals pulls discounts from Steam's public store API, hides what you own, and ranks what's left. Settings and any API key you add stay in this browser. No ads, no tracking. The user count is anonymous: one random id per browser, nothing tied to you or your Steam account. Not affiliated with Valve Corporation."
          : "Steam Deals pulls discounts straight from Steam's public store API, hides what you own, and ranks what's left. No accounts, no telemetry, no third parties. Not affiliated with Valve Corporation.")),
    ),
  );
  api.version().then((r) => {
    if (r.ok) $("#about")?.append(el("div", { style: { marginTop: "6px" } }, `Version ${r.value}`));
  });
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
  $("#scrim").onclick = () => { closeDrawer(); closeModal(); };
}
function closeModal() {
  const modal = $("#modal");
  if (!modal.classList.contains("open")) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  if (!$("#drawer").classList.contains("open")) $("#scrim").classList.remove("open");
  renderSidebar(); // reflect any store/depth changes
}

// ---------- keyboard ----------
function onKey(e) {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
  if (e.key === "Escape") {
    closeMenu();
    if ($("#modal").classList.contains("open")) return closeModal();
    if ($("#drawer").classList.contains("open")) return closeDrawer();
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

// ---------- boot ----------
async function init() {
  if (typeof api.ready === "function") await api.ready(); // website: load config, finish a Steam sign-in redirect
  const s = await api.settings.get();
  state.settings = s.settings;
  // Older builds offered different scan depths; snap anything unknown to the standard depth.
  if (!SCAN_DEPTHS.some(([v]) => v === Number(state.settings.scanDepth))) {
    state.settings.scanDepth = 10000;
    api.settings.update({ scanDepth: 10000 });
  }
  const st = await api.auth.status();
  state.account = st.ok ? st.account : null;
  api.deals.onProgress(setProgress);
  api.deals.onPartial(onDealsPartial);
  api.taste.onProgress((p) => {
    state.tasteProgress = p;
    if (state.tasteLoading) renderForYouHead();
  });
  document.addEventListener("keydown", onKey);
  // Narrow screens: the filters drawer closes on Escape or a tap anywhere outside it.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.body.classList.remove("filters-open");
  });
  document.addEventListener("click", (e) => {
    if (!document.body.classList.contains("filters-open")) return;
    if (e.target.closest("#sidebar") || e.target.closest(".filters-btn")) return;
    document.body.classList.remove("filters-open");
  });
  setInterval(renderUpdated, 30000);
  if (!state.account) renderLogin();
  else {
    renderBrowse();
    loadAll();
  }
  ensureTaxRegion();
  // Desktop: baskets handed over from the website (steamdeals:// links), now or while running.
  if (api.deeplink) {
    api.deeplink.onBasket((p) => receiveBasket(p?.items, "web"));
    api.deeplink.pending().then((p) => { if (p?.ok && p.basket) receiveBasket(p.basket.items, "web"); });
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
  // Desktop: the tray menu can flip a few settings while the window is hidden.
  api.settings.onChanged?.((s) => {
    state.settings = { ...state.settings, ...s };
  });
  const f = api.features || {};
  if (f.justSignedIn) toast(`Welcome, ${f.justSignedIn}`, { type: "ok" });
  if (f.privateProfile) toast("Your Steam profile's Game details are private, so owned games can't be hidden. Set them to Public in Steam, then refresh.", { type: "err", timeout: 12000 });
  if (f.siteKeyInvalid) toast("You're signed in, but this site can't read Steam libraries right now (its Steam connection needs fixing). Deals still work; try again later or use your own API key.", { type: "err", timeout: 14000 });
  if (f.signInError) toast(`Sign-in didn't finish: ${f.signInError}`, { type: "err", timeout: 10000 });
}
init().catch((err) => {
  console.error(err);
  toast(`Startup failed: ${err.message}`, { type: "err", timeout: 10000 });
});
