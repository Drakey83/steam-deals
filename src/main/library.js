// The signed-in person's library, and the taste profile learned from it.
const settings = require("./settings");
const cache = require("./cache");
const steam = require("./steam");
const session = require("./steam-session");
const { sendToUI } = require("./runtime");

const LIBRARY_TTL_MS = 10 * 60 * 1000;
const TASTE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const ITEM_TAGS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SAMPLE_SIZE = 220;

/** Owned games and wishlist ({ signedIn:false, sessionExpired:true } if Steam no longer accepts the session). */
async function fetchLibrary({ force = false } = {}) {
  const s = settings.get();
  const account = s.account;
  if (!account || account.method === "guest" || !account.steamid) return { owned: [], wishlist: [], signedIn: false, fromCache: false };
  const key = `library:${account.method}:${account.steamid}`;
  if (!force) {
    const hit = cache.get(key, LIBRARY_TTL_MS);
    if (hit) return { ...hit.value, fromCache: true, age: hit.age };
  }
  let value;
  if (account.method === "steam") {
    const ud = await session.userData(account.steamid);
    if (!ud.signedIn) return { owned: [], wishlist: [], signedIn: false, sessionExpired: true, fromCache: false };
    value = { owned: ud.owned, wishlist: ud.wishlist, signedIn: true };
  } else {
    const owned = await steam.fetchOwnedWithKey(s.apiKey, account.steamid);
    const wishlist = await steam.fetchWishlist(account.steamid).catch(() => []);
    value = { owned, wishlist, signedIn: true };
  }
  cache.set(key, value);
  return { ...value, fromCache: false };
}

/** The library with playtime: via the session token, else the plain owned list (no hours). */
async function gamesWithPlaytime(account, apiKey) {
  if (account.method !== "steam") return { games: await steam.fetchOwnedGamesDetailed({ steamid: account.steamid, apiKey }), source: "apikey" };
  try {
    const token = await session.webApiToken();
    return { games: await steam.fetchOwnedGamesDetailed({ steamid: account.steamid, accessToken: token }), source: "session" };
  } catch (err) {
    console.warn("[taste] token path unavailable:", err.message);
  }
  const ud = await session.userData(account.steamid);
  if (!ud.signedIn) return { games: null, source: null };
  return { games: ud.owned.map((appid) => ({ appid, name: null, playtime: 0, recent: 0 })), source: "userdata" };
}

/**
 * Learn what the person likes from their library, weighted by playtime. Runs on every refresh, which is
 * what lets the profile follow what they're playing now; unchanged libraries reuse the cached profile.
 */
async function buildTaste({ force = false } = {}) {
  const s = settings.get();
  const a = s.account;
  if (!a || a.method === "guest" || !a.steamid) return { taste: null, reason: "guest" };
  const key = `taste:v2:${a.method}:${a.steamid}:${s.language}`;
  const cached = cache.get(key, TASTE_TTL_MS);

  const { games, source } = await gamesWithPlaytime(a, s.apiKey);
  if (!games) return cached ? { taste: cached.value, fromCache: true, stale: true } : { taste: null, reason: "session_expired" };

  // Nothing changed since last time (same games, same hours)? Reuse the profile.
  const sample = steam.pickSample(games, SAMPLE_SIZE);
  const fingerprint = steam.libraryFingerprint(sample);
  if (!force && cached && cached.value?.fingerprint === fingerprint) return { taste: cached.value, fromCache: true };

  // Tags: remember every game already looked up, so a rebuild only fetches newcomers.
  const tagKey = `itemtags:v1:${s.language}`;
  const known = cache.get(tagKey, ITEM_TAGS_TTL_MS)?.value || {};
  const missing = sample.filter((g) => !known[g.appid] || (force && known[g.appid].type === -1)).map((g) => g.appid);
  sendToUI("taste:progress", { done: 0, total: missing.length });
  if (missing.length) {
    const fetched = await steam.fetchItems(missing, { language: s.language, country: s.country, onProgress: (p) => sendToUI("taste:progress", p) });
    for (const it of fetched) known[it.appid] = { name: it.name, type: it.type, tags: it.tags };
    for (const id of missing) if (!known[id]) known[id] = { name: null, type: -1, tags: [] }; // delisted/unknown: remember the miss
    cache.set(tagKey, known);
  }
  const items = sample.map((g) => ({ appid: g.appid, ...(known[g.appid] || { name: null, type: -1, tags: [] }) }));

  const taste = steam.buildTasteProfile(sample, items);
  Object.assign(taste, { source, libraryCount: games.length, builtAt: Date.now(), fingerprint });
  cache.set(key, taste);
  return { taste, fromCache: false };
}

module.exports = { fetchLibrary, buildTaste };
