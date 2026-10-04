// All Steam HTTP lives here. No Electron imports, so this file also runs as a plain
// Node self-test:  node src/main/steam.js --selftest
//
// Two tiers of endpoints:
//   keyless  – store query (deals), tag list, public profile XML, store "userdata" (needs session cookies)
//   keyed    – IPlayerService/GetOwnedGames + ResolveVanityURL (optional API-key fallback)

const API = "https://api.steampowered.com";
const STORE = "https://store.steampowered.com";
const COMMUNITY = "https://steamcommunity.com";

const PAGE_SIZE = 500; // verified: Query/v1 returns up to 500 items per page
const PAGE_SPACING_MS = 250;
const SERVER_MIN_DISCOUNT = 50; // fixed server-side filter; UI narrows client-side

class SteamError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "SteamError";
    this.status = status ?? null;
    this.code = code ?? "steam_error";
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  const e = new Error("Cancelled");
  e.name = "AbortError";
  return e;
}

/**
 * fetch JSON with retries on 429/5xx. `fetchImpl` lets the caller pass an Electron
 * session.fetch so cookies are included (needed for store userdata).
 */
async function fetchJSON(url, { fetchImpl = globalThis.fetch, headers = {}, signal, retries = 3 } = {}) {
  let delay = 1500;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      if (attempt >= retries) throw new SteamError(`Network error: ${err.message}`, null, "network");
      await sleep(delay, signal);
      delay *= 2;
      continue;
    }
    if (res.ok) {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new SteamError("Steam returned a non-JSON response", res.status, "bad_json");
      }
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new SteamError(`Steam returned HTTP ${res.status}`, res.status, res.status === 429 ? "rate_limited" : "http");
    }
    await sleep(delay, signal);
    delay *= 2;
  }
}

async function fetchText(url, { fetchImpl = globalThis.fetch, signal } = {}) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new SteamError(`Steam returned HTTP ${res.status}`, res.status, "http");
  return res.text();
}

function headerImage(appid) {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}

function storeUrl(appid) {
  return `${STORE}/app/${appid}/`;
}

/** Normalize a Query/v1 store_item into the compact shape the UI uses. Returns null for non-games. */
function normalizeItem(it) {
  if (!it || it.success === false || it.visible === false) return null;
  if (it.item_type !== undefined && it.item_type !== 0) return null; // 0 = app
  if (it.type !== undefined && it.type !== 0) return null; // 0 = game (not DLC/demo/music/software…)
  if (it.is_free) return null;
  const bpo = it.best_purchase_option;
  if (!bpo) return null;
  const discount = Number(bpo.discount_pct ?? 0);
  if (!Number.isFinite(discount) || discount <= 0) return null;
  const rev = it.reviews?.summary_filtered ?? it.reviews?.summary_unfiltered ?? null;
  const finalCents = Number(bpo.final_price_in_cents);
  const origCents = Number(bpo.original_price_in_cents);
  return {
    appid: it.appid,
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
    tagids: Array.isArray(it.tags) ? it.tags.map((t) => t.tagid).filter(Number.isFinite) : [],
    description: it.basic_info?.short_description ?? "",
    image: headerImage(it.appid),
    url: storeUrl(it.appid),
  };
}

/**
 * Page through Steam's catalog query for discounted games, most popular first.
 * Resolves { items, total, fetchedAt, truncated }.
 */
async function fetchDeals({
  country = "US",
  language = "english",
  limit = 3000,
  minDiscount = SERVER_MIN_DISCOUNT,
  pageSize = PAGE_SIZE,
  onProgress,
  signal,
  fetchImpl,
} = {}) {
  const items = [];
  const seen = new Set();
  let start = 0;
  let total = null;
  for (;;) {
    const count = Math.min(pageSize, limit - start);
    if (count <= 0) break;
    const input = {
      query: {
        start,
        count,
        sort: 10, // popularity: puts real games into the window instead of appid-ordered shovelware
        filters: {
          price_filters: { min_discount_percent: minDiscount },
          type_filters: { include_apps: true, include_games: true },
          released_only: true,
        },
      },
      context: { language, country_code: country, steam_realm: 1 },
      data_request: {
        include_basic_info: true,
        include_reviews: true,
        include_release: true,
        include_tag_count: 8,
      },
    };
    const url = `${API}/IStoreQueryService/Query/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetchJSON(url, { signal, fetchImpl });
    const page = res?.response?.store_items ?? [];
    total ??= res?.response?.metadata?.total_matching_records ?? null;
    for (const raw of page) {
      const it = normalizeItem(raw);
      if (it && !seen.has(it.appid) && it.discount >= minDiscount) {
        seen.add(it.appid);
        items.push(it);
      }
    }
    start += page.length;
    onProgress?.({ fetched: start, target: total === null ? limit : Math.min(limit, total), total });
    if (page.length === 0 || (total !== null && start >= total) || start >= limit) break;
    await sleep(PAGE_SPACING_MS, signal);
  }
  return { items, total, scanned: start, fetchedAt: Date.now(), truncated: total !== null && start < total };
}

/** tagid -> name for the given store language. */
async function fetchTagList(language = "english", { signal, fetchImpl } = {}) {
  const res = await fetchJSON(`${API}/IStoreService/GetTagList/v1/?language=${encodeURIComponent(language)}`, { signal, fetchImpl });
  const out = {};
  for (const t of res?.response?.tags ?? []) if (Number.isFinite(t.tagid) && t.name) out[t.tagid] = t.name;
  return out;
}

/**
 * Owned apps + wishlist for the signed-in store session. `fetchImpl` MUST be the
 * Electron session's fetch so the Steam cookies ride along. Without a session the
 * endpoint answers 200 with empty arrays, which we report as `signedIn: false`.
 */
async function fetchUserData({ fetchImpl, steamid, signal }) {
  const url = `${STORE}/dynamicstore/userdata/?id=${encodeURIComponent(steamid ?? "")}&_=${Date.now()}`;
  const res = await fetchJSON(url, { fetchImpl, signal, headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  const owned = Array.isArray(res?.rgOwnedApps) ? res.rgOwnedApps : [];
  const wishlist = Array.isArray(res?.rgWishlist) ? res.rgWishlist : [];
  const ownedPackages = Array.isArray(res?.rgOwnedPackages) ? res.rgOwnedPackages : [];
  return {
    owned,
    wishlist,
    signedIn: owned.length > 0 || ownedPackages.length > 0 || wishlist.length > 0,
    country: typeof res?.rgCountryCode === "string" ? res.rgCountryCode : null,
  };
}

/** Public profile XML -> { name, avatar, privacy }. Works with no key for public profiles. */
async function fetchProfile(steamid, { signal, fetchImpl } = {}) {
  const xml = await fetchText(`${COMMUNITY}/profiles/${encodeURIComponent(steamid)}/?xml=1`, { signal, fetchImpl });
  const pick = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
    return m ? m[1].trim() : null;
  };
  return {
    name: pick("steamID"),
    avatar: pick("avatarFull") ?? pick("avatarMedium"),
    privacy: pick("privacyState"),
  };
}

function isSteamId64(value) {
  return /^7656119\d{10}$/.test(String(value ?? "").trim());
}

/** Keyless wishlist appids for a public profile (used by the API-key path; the store session path gets it from userdata). */
async function fetchWishlist(steamid, { signal, fetchImpl } = {}) {
  const res = await fetchJSON(`${API}/IWishlistService/GetWishlist/v1/?steamid=${encodeURIComponent(steamid)}`, { signal, fetchImpl });
  const items = res?.response?.items;
  return Array.isArray(items) ? items.map((i) => i.appid).filter(Number.isFinite) : [];
}

// ---------- Optional API-key fallback ----------

async function resolveVanity(apiKey, vanity, { signal } = {}) {
  const res = await fetchJSON(
    `${API}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`,
    { signal },
  );
  if (res?.response?.success !== 1 || !res.response.steamid) throw new SteamError("That profile name could not be found", 404, "not_found");
  return res.response.steamid;
}

async function fetchOwnedWithKey(apiKey, steamid, { signal } = {}) {
  const url =
    `${API}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid)}` +
    `&include_played_free_games=1&include_free_sub=1`;
  let res;
  try {
    res = await fetchJSON(url, { signal, retries: 1 });
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) throw new SteamError("Steam rejected that API key", err.status, "bad_key");
    throw err;
  }
  const games = res?.response?.games;
  if (!Array.isArray(games)) {
    throw new SteamError("Steam returned no games. Make sure the profile's Game details are set to Public.", 200, "private");
  }
  return games.map((g) => g.appid);
}

module.exports = {
  SteamError,
  SERVER_MIN_DISCOUNT,
  PAGE_SIZE,
  fetchDeals,
  fetchTagList,
  fetchUserData,
  fetchProfile,
  fetchWishlist,
  fetchOwnedWithKey,
  resolveVanity,
  isSteamId64,
  normalizeItem,
  headerImage,
  storeUrl,
};

// ---------- Self-test ----------
if (require.main === module && process.argv.includes("--selftest")) {
  (async () => {
    const t0 = Date.now();
    const deals = await fetchDeals({ limit: 50, pageSize: 50, onProgress: (p) => console.log("progress", p) });
    console.log(`deals: ${deals.items.length} games of ${deals.total} matching in ${Date.now() - t0} ms`);
    console.log("first:", deals.items[0]);
    const tags = await fetchTagList();
    console.log(`tags: ${Object.keys(tags).length}; 492 -> ${tags[492]}`);
    const profile = await fetchProfile("76561197960287930");
    console.log("profile:", profile);
    const ud = await fetchUserData({ fetchImpl: globalThis.fetch, steamid: "" });
    console.log("userdata (no session):", { owned: ud.owned.length, wishlist: ud.wishlist.length, signedIn: ud.signedIn });
  })().catch((err) => {
    console.error("SELFTEST FAILED:", err);
    process.exit(1);
  });
}
