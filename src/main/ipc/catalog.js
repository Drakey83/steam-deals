// The Steam catalog: scanning deals (streamed page by page), tag names, looking up single games,
// the person's library, and the taste profile.
const settings = require("../settings");
const cache = require("../cache");
const steam = require("../steam");
const { buildTaste, fetchLibrary } = require("../library");
const { sendToUI } = require("../runtime");
const { handle } = require("./handle");

const DEALS_TTL_MS = 30 * 60 * 1000;
const TAGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CATALOG_CACHE_VERSION = "v4"; // bump when the shape of a cached deal changes
const MAX_LOOKUP = 100;

let dealsAbort = null;

async function fetchDeals({ force = false } = {}) {
  const s = settings.get();
  const discounted = s.catalog !== "all";
  // scanDepth 0 = "everything on sale" (~70k items); the whole catalog (~240k) stays capped at 25k.
  const depth = Number(s.scanDepth);
  const limit = depth === 0 && discounted ? Infinity : Math.min(Math.max(depth || 10000, 500), 25000);
  const key = `catalog:${CATALOG_CACHE_VERSION}:${discounted ? "sale" : "all"}:${s.country}:${s.language}:${s.scanDepth}:${steam.SERVER_MIN_DISCOUNT}`;
  if (!force) {
    const hit = cache.get(key, DEALS_TTL_MS);
    if (hit) return { ...hit.value, fromCache: true, age: hit.age };
  }
  dealsAbort?.abort();
  const controller = new AbortController();
  dealsAbort = controller;
  const runId = Date.now();
  try {
    const result = await steam.fetchDeals({
      country: s.country,
      language: s.language,
      limit,
      discounted,
      signal: controller.signal,
      onProgress: (p) => sendToUI("deals:progress", p),
      // Stream each page so the UI can show results while the scan continues.
      onPage: (items, meta) => sendToUI("deals:partial", { runId, items, ...meta, discounted }),
    });
    cache.set(key, result);
    return { ...result, runId, fromCache: false };
  } finally {
    if (dealsAbort === controller) dealsAbort = null;
  }
}

function register() {
  handle("deals:fetch", fetchDeals);
  handle("deals:cancel", () => {
    dealsAbort?.abort();
    return { value: true };
  });

  handle("tags:fetch", async () => {
    const s = settings.get();
    const key = `tags:${s.language}`;
    const hit = cache.get(key, TAGS_TTL_MS);
    if (hit) return { tags: hit.value, fromCache: true };
    const tags = await steam.fetchTagList(s.language);
    cache.set(key, tags);
    return { tags, fromCache: false };
  });

  handle("items:lookup", async ({ appids = [] } = {}) => {
    const s = settings.get();
    const ids = [...new Set(appids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_LOOKUP);
    if (!ids.length) return { items: [] };
    return { items: await steam.lookupItems(ids, { language: s.language, country: s.country }) };
  });

  handle("library:fetch", fetchLibrary);
  handle("taste:build", buildTaste);
}

module.exports = { register };
