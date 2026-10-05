// IsThereAnyDeal (https://isthereanydeal.com) price data, used for price history. The API key lives only here,
// on the server (env ITAD_API_KEY); the website and the desktop app both go through /api/history.
// Their terms: data must not be changed, and IsThereAnyDeal must be credited where it is shown.
const { HttpError } = require("./server.js");

const ITAD = "https://api.isthereanydeal.com";
const STEAM_SHOP = 61;
const MAX_BATCH = 200;

const configured = () => Boolean(process.env.ITAD_API_KEY);

async function call(path, { method = "GET", query = {}, body } = {}) {
  const qs = new URLSearchParams({ ...query, key: process.env.ITAD_API_KEY });
  const res = await fetch(`${ITAD}${path}?${qs}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 429) throw new HttpError(503, "Price history is busy right now. Try again in a few minutes.", "itad_busy");
  if (!res.ok) throw new HttpError(502, "Price history is unavailable right now.", "itad_down");
  return res.json();
}

// ----- pure shaping (unit-tested) -----

/** IsThereAnyDeal price object → cents (null if missing). */
const centsOf = (p) => (p && Number.isFinite(Number(p.amountInt)) ? Number(p.amountInt) : null);

/** Shop-id lookup response {"app/10": "uuid"|null} → Map appid → ITAD id. */
function idsFromLookup(json) {
  const out = new Map();
  for (const [key, id] of Object.entries(json || {})) {
    const m = /^app\/(\d+)$/.exec(key);
    if (m && typeof id === "string") out.set(Number(m[1]), id);
  }
  return out;
}

/** storelow/v2 entry → the Steam all-time low { cents, regularCents, cut, at, currency } or null. */
function steamLow(entry) {
  const low = (entry?.lows || []).find((l) => l?.shop?.id === STEAM_SHOP);
  if (!low) return null;
  const cents = centsOf(low.price);
  if (cents == null) return null;
  return { cents, regularCents: centsOf(low.regular), cut: Number(low.cut) || 0, at: Date.parse(low.timestamp) || null, currency: low.price.currency || null };
}

/** history/v2 log → Steam price points, oldest first: [{ at, cents, regularCents, cut }]. */
function steamPoints(log) {
  return (Array.isArray(log) ? log : [])
    .filter((e) => e?.shop?.id === STEAM_SHOP && e.deal)
    .map((e) => ({ at: Date.parse(e.timestamp), cents: centsOf(e.deal.price), regularCents: centsOf(e.deal.regular), cut: Number(e.deal.cut) || 0 }))
    .filter((p) => Number.isFinite(p.at) && p.cents != null)
    .sort((a, b) => a.at - b.at);
}

// ----- calls -----

/** Steam appids → ITAD game ids (games IsThereAnyDeal doesn't know are left out). */
async function lookupIds(appids) {
  const out = new Map();
  for (let i = 0; i < appids.length; i += MAX_BATCH) {
    const json = await call(`/lookup/id/shop/${STEAM_SHOP}/v1`, { method: "POST", body: appids.slice(i, i + MAX_BATCH).map((a) => `app/${a}`) });
    for (const [appid, id] of idsFromLookup(json)) out.set(appid, id);
  }
  return out;
}

/** ITAD ids → Steam all-time lows (Map id → low). */
async function steamLows(ids, country) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const json = await call("/games/storelow/v2", { method: "POST", query: { country, shops: String(STEAM_SHOP) }, body: ids.slice(i, i + MAX_BATCH) });
    for (const entry of Array.isArray(json) ? json : []) out.set(entry.id, steamLow(entry));
  }
  return out;
}

/** One game's Steam price log since `since` (ms). */
async function steamHistory(id, country, since) {
  const log = await call("/games/history/v2", { query: { id, country, shops: String(STEAM_SHOP), since: new Date(since).toISOString() } });
  return steamPoints(log);
}

module.exports = { configured, lookupIds, steamLows, steamHistory, idsFromLookup, steamLow, steamPoints, STEAM_SHOP };
