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
const SCAN_DEPTHS = [[1000, "Quick · 1,000 games"], [3000, "Standard · 3,000 games"], [6000, "Deep · 6,000 games"]];
const PAGE = 60;
const DEFAULT_FILTERS = { minDiscount: 50, minRating: 80, minReviews: 0, selectedTags: [], wishlistOnly: false, hideOwned: true, sort: "score" };

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
  setProgress({ label: "Connecting to Steam…" });
  renderStats();
  renderGrid(true);

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
    state.meta = {
      total: dealsRes.total,
      scanned: dealsRes.scanned || (dealsRes.items || []).length,
      fetchedAt: dealsRes.fetchedAt,
      fromCache: Boolean(dealsRes.fromCache),
      truncated: Boolean(dealsRes.truncated),
    };
  } else if (dealsRes.error.code !== "cancelled") {
    state.error = dealsRes.error;
    toast(`Couldn't load deals: ${dealsRes.error.message}`, { type: "err", action: () => loadAll({ force: true }) });
  }
  state.loading = false;
  setProgress(null);
  renderSidebar(); // library state affects the toggles; deals affect the tag list
  renderBanners();
  updateResults();
  renderUpdated();
}

async function refreshLibrary() {
  const r = await api.library.fetch({ force: true });
  if (!r.ok) return toast(r.error.message, { type: "err" });
  state.library = { owned: new Set(r.owned || []), wishlist: new Set(r.wishlist || []), signedIn: Boolean(r.signedIn), sessionExpired: Boolean(r.sessionExpired) };
  renderSidebar();
  renderBanners();
  updateResults();
  if (r.signedIn) toast(`Library refreshed · ${fmtInt(r.owned.length)} games`, { type: "ok" });
}

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
  } else {
    updateResults();
  }
}

// ---------- results ----------
function computeResults() {
  const s = state.settings;
  const lib = state.library;
  const hideOwned = s.hideOwned && lib.signedIn;
  const tags = s.selectedTags || [];
  const base = state.deals.filter((d) => d.discount >= s.minDiscount && (d.rating ?? -1) >= s.minRating && d.reviews >= s.minReviews);
  const ownedInBase = lib.signedIn ? base.filter((d) => lib.owned.has(d.appid)).length : 0;
  let pool = hideOwned ? base.filter((d) => !lib.owned.has(d.appid)) : base;
  if (s.wishlistOnly && lib.signedIn) pool = pool.filter((d) => lib.wishlist.has(d.appid));
  if (tags.length) pool = pool.filter((d) => tags.every((t) => d.tagids.includes(t)));

  const maxReviews = pool.reduce((m, d) => Math.max(m, d.reviews), 1);
  const logMax = Math.log10(maxReviews) || 1;
  const w = normWeights(s.weights);
  for (const d of pool) {
    d.popularity = d.reviews > 0 ? (100 * Math.log10(d.reviews)) / logMax : 0;
    d.parts = { discount: w.discount * d.discount, rating: w.rating * (d.rating ?? 0), popularity: w.popularity * d.popularity };
    d.score = d.parts.discount + d.parts.rating + d.parts.popularity;
  }
  const q = state.query.trim().toLowerCase();
  let list = q ? pool.filter((d) => d.name.toLowerCase().includes(q)) : pool.slice();
  const by = {
    score: (a, b) => b.score - a.score,
    discount: (a, b) => b.discount - a.discount || b.score - a.score,
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews,
    reviews: (a, b) => b.reviews - a.reviews,
    price: (a, b) => (a.priceCents ?? 1e12) - (b.priceCents ?? 1e12) || b.score - a.score,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  list.sort(by[s.sort] || by.score);
  return { list, ownedHidden: hideOwned ? ownedInBase : 0, poolSize: pool.length };
}

function updateResults() {
  if (!$("#grid")) return;
  const r = computeResults();
  state.results = r.list;
  state.ownedHidden = r.ownedHidden;
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

  const card = el(
    "div",
    { class: "login-card" },
    el("div", { class: "login-logo", html: ICON.percent }),
    el("h1", {}, "Steam Deals"),
    el("p", { class: "tagline" }, "The best discounts on Steam right now, minus everything you already own."),
    el("div", { class: "login-actions" }, signInBtn, guestBtn),
    el(
      "details",
      { class: "advanced" },
      el("summary", {}, "Use a Steam Web API key instead"),
      el(
        "div",
        { class: "advanced-form" },
        el("label", {}, "API key"),
        keyInput,
        el("label", {}, "Your Steam account"),
        idInput,
        el("div", { class: "hint" }, "Get a free key at ", linkTo("https://steamcommunity.com/dev/apikey", "steamcommunity.com/dev/apikey"), ". Your profile's Game details must be public."),
        keyBtn,
      ),
    ),
    el("p", { class: "login-foot" }, "You sign in on Steam's own page. This app never sees your password and only reads which games you own. Nothing leaves your computer except requests to Steam."),
  );
  app.append(el("div", { class: "login" }, el("div", { class: "blob blob-a" }), el("div", { class: "blob blob-b" }), el("div", { class: "blob blob-c" }), card));
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
    el("div", { id: "banners" }),
    el("div", { class: "stats", id: "stats" }),
    el("div", { class: "scroller", id: "scroller" }, el("div", { class: "grid", id: "grid" }), el("div", { class: "sentinel", id: "sentinel" })),
  );
  app.append(el("div", { class: "browse" }, sidebar, content));
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
  const sort = el("select", { class: "select", id: "sort", "aria-label": "Sort" }, SORTS.map(([v, l]) => el("option", { value: v, selected: state.settings.sort === v }, l)));
  sort.addEventListener("change", () => patchSettings({ sort: sort.value }, { persistNow: true }));
  const refresh = el("button", { class: "btn btn-icon", title: "Refresh deals", "aria-label": "Refresh", html: ICON.refresh });
  refresh.addEventListener("click", () => loadAll({ force: true }));
  return el(
    "div",
    { class: "topbar" },
    el("div", { class: "search", html: ICON.search }, search, el("kbd", {}, "/")),
    sort,
    el("div", { class: "spacer" }),
    el("span", { class: "updated", id: "updated" }),
    refresh,
    renderAccountChip(),
  );
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
  side.append(
    el("div", {}, el("div", { class: "section-title" }, "Filters", el("button", { class: "btn btn-ghost btn-sm", onclick: resetFilters }, "Reset")),
      el("div", { style: { display: "grid", gap: "14px" } },
        range("minDiscount", "Min discount", 50, 95, 5, (v) => `${v}%`),
        range("minRating", "Min rating", 50, 95, 5, (v) => `${v}%`),
        select("minReviews", "Min reviews", REVIEW_MINS),
      ),
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
    ),
  );
  renderTags();
}

function resetFilters() {
  patchSettings({ ...DEFAULT_FILTERS }, { persistNow: true });
  state.query = "";
  const s = $("#search");
  if (s) s.value = "";
  renderSidebar();
  const sort = $("#sort");
  if (sort) sort.value = "score";
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

function renderStats() {
  const host = $("#stats");
  if (!host) return;
  host.innerHTML = "";
  if (state.loading && !state.deals.length) {
    host.append(el("span", {}, "Scanning the Steam catalog…"));
    return;
  }
  const list = state.results;
  const best = list.reduce((m, d) => Math.max(m, d.discount), 0);
  const dot = () => el("span", { class: "dot" });
  host.append(el("span", {}, el("strong", {}, fmtInt(list.length)), " deals"));
  if (state.ownedHidden) host.append(dot(), el("span", {}, el("strong", {}, fmtInt(state.ownedHidden)), " owned hidden"));
  if (best) host.append(dot(), el("span", {}, "best discount ", el("strong", {}, `${best}%`)));
  if (state.meta.total) {
    host.append(
      dot(),
      el("span", { class: "muted", title: `${fmtInt(state.deals.length)} of those are purchasable games (the rest are DLC, bundles, software, etc.)` },
        `scanned the ${fmtInt(state.meta.scanned)} most popular of ${fmtInt(state.meta.total)} discounted items`),
    );
  }
  const w = normWeights(state.settings.weights);
  host.append(el("span", { class: "spacer" }), el("span", { class: "pill pill-info", title: "Score weights: discount / rating / popularity" }, `${Math.round(w.discount * 100)} · ${Math.round(w.rating * 100)} · ${Math.round(w.popularity * 100)}`));
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
    $("#scroller").scrollTop = 0;
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
  const card = el(
    "button",
    { class: "card", dataset: { appid: d.appid }, "aria-label": `${d.name}, ${d.discount}% off, ${d.price}` },
    el("div", { class: "card-art" },
      imgEl(d.image, ""),
      el("span", { class: "badge-discount num" }, `-${d.discount}%`),
      el("div", { class: "ring", style: { "--p": Math.round(d.score) }, title: `Score ${d.score.toFixed(1)} · #${rank}` }, el("span", { class: "num" }, Math.round(d.score))),
      owned ? el("span", { class: "ribbon" }, "Owned") : null,
      wished ? el("span", { class: "heart", html: ICON.heart, title: "On your wishlist" }) : null,
    ),
    el("div", { class: "card-body" },
      el("div", { class: "card-title", title: d.name }, d.name),
      el("div", { class: "price-row" }, el("span", { class: "price num" }, d.price ?? "—"), d.originalPrice ? el("span", { class: "price-orig num" }, d.originalPrice) : null),
      el("div", { class: `rating-row ${ratingClass(d.rating)}` },
        el("span", { class: "pct num" }, d.rating != null ? `${d.rating}%` : "n/a"),
        d.reviewLabel ? el("span", { class: "lbl" }, d.reviewLabel) : null,
        el("span", { class: "muted num" }, `· ${fmtInt(d.reviews)}`),
      ),
      el("div", { class: "tag-row" }, d.tagids.slice(0, 3).map((t) => el("span", { class: "chip chip-sm" }, tagName(t)))),
    ),
  );
  card.addEventListener("click", () => openDrawer(d));
  return card;
}

// ---------- drawer ----------
function openDrawer(d) {
  state.selected = d;
  const drawer = $("#drawer");
  drawer.innerHTML = "";
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
        owned ? el("span", { class: "chip chip-sm on" }, "In your library") : null,
        wished ? el("span", { class: "chip chip-sm", style: { color: "var(--pink)", borderColor: "rgba(255,126,182,.5)" } }, "On your wishlist") : null,
      ),
      el("div", { class: "buy-row" },
        el("span", { class: "badge-discount num" }, `-${d.discount}%`),
        el("div", {}, el("div", { class: "price num" }, d.price ?? "—"), d.originalPrice ? el("div", { class: "price-orig num" }, d.originalPrice) : null),
        el("div", { class: "actions" },
          el("button", { class: "btn btn-primary btn-sm", html: `${ICON.external}<span>Open on Steam</span>`, onclick: () => api.openExternal(d.url) }),
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
  drawer.classList.remove("open");
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
      el("div", { class: "settings-group" }, el("h3", {}, "Account"), accountRow),
      el("div", { class: "settings-group" }, el("h3", {}, "About"),
        el("div", { class: "about", id: "about" }, "Steam Deals pulls discounts straight from Steam's public store API, hides what you own, and ranks what's left. No accounts, no telemetry, no third parties. Not affiliated with Valve Corporation.")),
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
  const s = await api.settings.get();
  state.settings = s.settings;
  const st = await api.auth.status();
  state.account = st.ok ? st.account : null;
  api.deals.onProgress(setProgress);
  document.addEventListener("keydown", onKey);
  setInterval(renderUpdated, 30000);
  if (!state.account) renderLogin();
  else {
    renderBrowse();
    loadAll();
  }
}
init().catch((err) => {
  console.error(err);
  toast(`Startup failed: ${err.message}`, { type: "err", timeout: 10000 });
});
