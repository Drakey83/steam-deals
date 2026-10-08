// Pure logic shared by the desktop app (Node, via require) and the website (browser script and
// Vercel functions). No I/O here. Loads as CommonJS where `module` exists, otherwise as window.SteamCore.
(function (root) {
const STORE = "https://store.steampowered.com";

// Steam keeps newer games' art under a hashed path (steam/apps/<appid>/<hash>/header.jpg); the plain
// steam/apps/<appid>/header.jpg is missing for many of them, so a game's own listed path comes first.
const STEAM_ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/";
function itemImage(it) {
  const fmt = it?.assets?.asset_url_format;
  const file = it?.assets?.header;
  return fmt && file ? STEAM_ASSETS + fmt.replace("${FILENAME}", file) : headerImage(it?.appid);
}

/** The plain address of a game's header art: right for older games, and the fallback when nothing better is known. */
function headerImage(appid) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}

function storeUrl(appid) {
  return `${STORE}/app/${appid}/`;
}

/** Normalize a Query/v1 store_item into the compact shape the UI uses. Returns null for non-games. */
function normalizeItem(it, { requireDiscount = true } = {}) {
  if (!it || it.success === false || it.visible === false) return null;
  if (it.item_type !== undefined && it.item_type !== 0) return null; // 0 = app
  if (it.type !== undefined && it.type !== 0) return null; // 0 = game (not DLC/demo/music/software…)
  if (it.is_free) return null;
  const bpo = it.best_purchase_option;
  if (!bpo) return null;
  const discount = Number(bpo.discount_pct ?? 0) || 0;
  if (!Number.isFinite(discount) || (requireDiscount && discount <= 0)) return null;
  const rev = it.reviews?.summary_filtered ?? it.reviews?.summary_unfiltered ?? null;
  const finalCents = Number(bpo.final_price_in_cents);
  const origCents = Number(bpo.original_price_in_cents);
  return {
    appid: it.appid,
    packageid: Number.isFinite(Number(bpo.packageid)) ? Number(bpo.packageid) : null, // what Steam's cart takes
    name: it.name ?? `App ${it.appid}`,
    discount,
    price: bpo.formatted_final_price ?? null,
    originalPrice: bpo.formatted_original_price ?? null,
    priceCents: Number.isFinite(finalCents) ? finalCents : null,
    originalCents: Number.isFinite(origCents) ? origCents : null,
    rating: typeof rev?.percent_positive === "number" ? rev.percent_positive : null,
    reviews: typeof rev?.review_count === "number" ? rev.review_count : 0,
    reviewLabel: rev?.review_score_label ?? null,
    released: it.release?.steam_release_date ? it.release.steam_release_date * 1000 : null,
    earlyAccess: Boolean(it.release?.is_early_access),
    // Valve's compatibility ratings: 0 unknown/untested, 1 unsupported, 2 playable, 3 verified.
    deck: compatCategory(it.platforms?.steam_deck_compat_category),
    machine: compatCategory(it.platforms?.steam_machine_compat_category),
    tagids: Array.isArray(it.tags) ? it.tags.map((t) => t.tagid).filter(Number.isFinite) : [],
    tags: normTags(it.tags),
    description: it.basic_info?.short_description ?? "",
    image: itemImage(it),
    url: storeUrl(it.appid),
  };
}

const compatCategory = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 3 ? Number(v) : 0);
const COMPAT_LABELS = ["Not rated yet", "Unsupported", "Playable", "Verified"];

/** Steam's store tags carry a relevance weight. Normalize so each game's tag weights sum to 1. */
function normTags(tags) {
  const arr = Array.isArray(tags) ? tags.filter((t) => Number.isFinite(t?.tagid)) : [];
  const total = arr.reduce((s, t) => s + (Number(t.weight) || 1), 0) || 1;
  return arr.map((t) => ({ id: t.tagid, w: (Number(t.weight) || 1) / total }));
}

/**
 * Compact fingerprint of what matters to the taste profile: which games are owned and how much
 * they've been played (to the hour). When it changes, the profile is rebuilt — that's how the app
 * keeps learning as the person plays.
 */
function libraryFingerprint(games) {
  const parts = games
    .map((g) => `${g.appid}:${Math.floor((g.playtime || 0) / 60)}:${Math.floor((g.recent || 0) / 60)}`)
    .sort();
  // djb2 over the joined string — cheap and stable.
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${games.length}-${(h >>> 0).toString(16)}`;
}

/**
 * Choose which owned games to learn from: the most-played first, then a spread of the rest,
 * so the profile reflects what the person actually plays without dozens of extra requests.
 */
function pickSample(games, max = 220) {
  const out = [];
  const seen = new Set();
  const add = (g) => {
    if (!seen.has(g.appid) && out.length < max) {
      seen.add(g.appid);
      out.push(g);
    }
  };
  // Everything played in the last two weeks always makes the cut: that's the freshest taste signal.
  games.filter((g) => g.recent > 0).sort((a, b) => b.recent - a.recent).forEach(add);
  games.filter((g) => g.playtime > 0).sort((a, b) => b.playtime - a.playtime).slice(0, 160).forEach(add);
  const unplayed = games.filter((g) => !(g.playtime > 0));
  const room = max - out.length;
  if (room > 0 && unplayed.length) {
    const step = Math.max(1, Math.ceil(unplayed.length / room));
    for (let i = 0; i < unplayed.length && out.length < max; i += step) add(unplayed[i]);
  }
  return out;
}

/**
 * Build a tag-affinity profile from owned games. Played games count more (log of hours);
 * unplayed games still whisper. Returns tag shares (sum to 1) plus "anchor" games for
 * "because you played …" explanations.
 */
function buildTasteProfile(games, items) {
  const byApp = new Map(items.filter((i) => i.type === 0 && i.tags.length).map((i) => [i.appid, i]));
  const hasPlaytime = games.some((g) => g.playtime > 0);
  const aff = new Map();
  const anchors = [];
  let basedOn = 0;
  let totalW = 0;
  for (const g of games) {
    const it = byApp.get(g.appid);
    if (!it) continue;
    const hours = (g.playtime || 0) / 60;
    const recentHours = (g.recent || 0) / 60;
    // Lifetime hours set the base weight; anything played in the last two weeks gets a fresh boost,
    // so the profile drifts toward what the person is into right now.
    let w = hasPlaytime ? (hours > 0 ? 1 + Math.log2(1 + hours) : 0.35) : 1;
    if (recentHours > 0) w += 1.5 + Math.log2(1 + recentHours);
    basedOn++;
    totalW += w;
    for (const t of it.tags) aff.set(t.id, (aff.get(t.id) || 0) + w * t.w);
    anchors.push({ appid: g.appid, name: it.name || g.name || `App ${g.appid}`, hours: Math.round(hours * 10) / 10, recent: Math.round(recentHours * 10) / 10, w, tags: it.tags });
  }
  const affinity = {};
  for (const [id, v] of aff) affinity[id] = v / (totalW || 1);
  anchors.sort((a, b) => b.w - a.w);
  return {
    affinity,
    anchors: anchors.slice(0, 80).map(({ appid, name, hours, recent, tags }) => ({ appid, name, hours, recent, tags })),
    basedOn,
    hasPlaytime,
  };
}

function isSteamId64(value) {
  return /^7656119\d{10}$/.test(String(value ?? "").trim());
}

/** Steam catalog query (IStoreQueryService/Query/v1) input for one page, most popular first. */
/**
 * The smallest discount a scan asks Steam for, given the person's "Min discount" (0 = any sale). Steam is asked
 * for one of a few fixed floors so scans are shared (the website's edge cache, the app's cache); the list is then
 * narrowed to the exact minimum on the device. Lowering the minimum below the last scan's floor needs a new scan.
 */
const SCAN_FLOORS = [50, 25, 10, 1];
function scanFloor(minDiscount) {
  const m = Math.max(0, Number(minDiscount) || 0);
  return SCAN_FLOORS.find((f) => f <= Math.max(1, m)) ?? 1;
}

function buildQueryInput({ start = 0, count = 500, discounted = true, minDiscount = 50, language = "english", country = "US" } = {}) {
  const filters = { type_filters: { include_apps: true, include_games: true }, released_only: true };
  if (discounted) filters.price_filters = { min_discount_percent: minDiscount };
  return {
    query: { start, count, sort: 10, filters },
    context: { language, country_code: country, steam_realm: 1 },
    data_request: { include_basic_info: true, include_reviews: true, include_release: true, include_tag_count: 8, include_platforms: true, include_assets: true },
  };
}

// ---------- sales-tax estimate for the basket ----------
// Steam shows prices before tax in the US and Canada and adds tax at checkout from the billing
// address. Everywhere else the price already includes tax. These are state/province base rates;
// local add-ons and digital-goods rules vary, so the basket always calls this an estimate.
const TAX_REGIONS = [
  { code: "included", name: "Prices include tax", rate: 0, group: "" },
  { code: "none", name: "No sales tax on games where I live", rate: 0, group: "" },
  ...[
    ["AL", "Alabama", 4], ["AK", "Alaska", 0], ["AZ", "Arizona", 5.6], ["AR", "Arkansas", 6.5], ["CA", "California", 7.25],
    ["CO", "Colorado", 2.9], ["CT", "Connecticut", 6.35], ["DE", "Delaware", 0], ["DC", "District of Columbia", 6], ["FL", "Florida", 6],
    ["GA", "Georgia", 4], ["HI", "Hawaii", 4], ["ID", "Idaho", 6], ["IL", "Illinois", 6.25], ["IN", "Indiana", 7], ["IA", "Iowa", 6],
    ["KS", "Kansas", 6.5], ["KY", "Kentucky", 6], ["LA", "Louisiana", 5], ["ME", "Maine", 5.5], ["MD", "Maryland", 6],
    ["MA", "Massachusetts", 6.25], ["MI", "Michigan", 6], ["MN", "Minnesota", 6.875], ["MS", "Mississippi", 7], ["MO", "Missouri", 4.225],
    ["MT", "Montana", 0], ["NE", "Nebraska", 5.5], ["NV", "Nevada", 6.85], ["NH", "New Hampshire", 0], ["NJ", "New Jersey", 6.625],
    ["NM", "New Mexico", 4.875], ["NY", "New York", 4], ["NC", "North Carolina", 4.75], ["ND", "North Dakota", 5], ["OH", "Ohio", 5.75],
    ["OK", "Oklahoma", 4.5], ["OR", "Oregon", 0], ["PA", "Pennsylvania", 6], ["RI", "Rhode Island", 7], ["SC", "South Carolina", 6],
    ["SD", "South Dakota", 4.2], ["TN", "Tennessee", 7], ["TX", "Texas", 6.25], ["UT", "Utah", 4.85], ["VT", "Vermont", 6],
    ["VA", "Virginia", 5.3], ["WA", "Washington", 6.5], ["WV", "West Virginia", 6], ["WI", "Wisconsin", 5], ["WY", "Wyoming", 4],
  ].map(([c, n, r]) => ({ code: `US-${c}`, name: n, rate: r, group: "United States (state base rate)" })),
  ...[
    ["AB", "Alberta", 5], ["BC", "British Columbia", 12], ["MB", "Manitoba", 12], ["NB", "New Brunswick", 15], ["NL", "Newfoundland and Labrador", 15],
    ["NS", "Nova Scotia", 14], ["NT", "Northwest Territories", 5], ["NU", "Nunavut", 5], ["ON", "Ontario", 13], ["PE", "Prince Edward Island", 15],
    ["QC", "Quebec", 14.975], ["SK", "Saskatchewan", 11], ["YT", "Yukon", 5],
  ].map(([c, n, r]) => ({ code: `CA-${c}`, name: n, rate: r, group: "Canada (GST/HST/PST)" })),
  { code: "custom", name: "Custom rate…", rate: null, group: "" },
];

/** Default tax region for a store country: US/CA people must pick a state/province; everyone else is tax-inclusive. */
function defaultTaxRegion(country) {
  return country === "US" || country === "CA" ? null : "included";
}

/** Map a detected country + state/province to a tax region code, or null when it can't be decided. */
function taxRegionFor(country, region) {
  if (!country) return null;
  if (country === "US" || country === "CA") {
    const code = `${country}-${String(region || "").toUpperCase()}`;
    return TAX_REGIONS.some((t) => t.code === code) ? code : null;
  }
  return "included";
}

/** { rate, taxCents } for a subtotal in cents. `customRate` is a percent used when region is "custom". */
function estimateTax(subtotalCents, region, customRate) {
  let rate = 0;
  if (region === "custom") rate = Math.max(0, Number(customRate) || 0);
  else {
    const r = TAX_REGIONS.find((t) => t.code === region);
    rate = r && r.rate ? r.rate : 0;
  }
  return { rate, taxCents: Math.round((subtotalCents * rate) / 100) };
}

// ---------- shared basket (used by the desktop sync engine and the website) ----------

/** Where a shared-basket change was made, for messages ("added on your phone"). The relay records "pc", "phone" or
 *  "web" (any browser that isn't a phone); anything else is "on another device". */
function deviceWhere(by) {
  return by === "phone" ? "on your phone" : by === "web" ? "in a browser" : by === "pc" ? "on your PC" : "on another device";
}

/**
 * The basket the interface is saving (`next`), checked against what its screen has actually shown (`shown`).
 * A game in the current basket that the screen never showed can't have been taken out on purpose: it arrived
 * from another device while the screen was out of date. It stays. Without this, a screen showing an old empty
 * basket would send "empty" back as the new basket and wipe it on every device (and out of the Steam cart).
 * `shown` null = not known, nothing is changed.
 */
function keepUnseen(current, next, shown) {
  if (!Array.isArray(shown)) return next;
  const seen = new Set(shown.map((i) => i.appid));
  const inNext = new Set((next || []).map((i) => i.appid));
  const kept = (current || []).filter((i) => !seen.has(i.appid) && !inNext.has(i.appid));
  return kept.length ? [...(next || []), ...kept] : next;
}

/** True when two baskets hold the same games (ignores names and prices). */
function sameBasket(a, b) {
  const key = (list) => JSON.stringify((list || []).map((i) => [i.appid, i.packageid]));
  return key(a) === key(b);
}

/** The add/remove operations that turn basket `prev` into `next` (sent to the pairing relay). */
function basketOps(prev, next) {
  const before = new Map((prev || []).map((i) => [i.appid, i]));
  const after = new Map((next || []).map((i) => [i.appid, i]));
  const ops = [];
  for (const [appid] of before) if (!after.has(appid)) ops.push({ op: "remove", appid });
  for (const [appid, item] of after) {
    const old = before.get(appid);
    if (!old || JSON.stringify(old) !== JSON.stringify(item)) ops.push({ op: "add", item });
  }
  return ops;
}

const api = { scanFloor, SCAN_FLOORS, keepUnseen, deviceWhere, sameBasket, basketOps, COMPAT_LABELS, headerImage, storeUrl, normalizeItem, normTags, libraryFingerprint, pickSample, buildTasteProfile, isSteamId64, buildQueryInput, TAX_REGIONS, defaultTaxRegion, taxRegionFor, estimateTax };
if (typeof module === "object" && module.exports) module.exports = api;
else root.SteamCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
