// Price history from IsThereAnyDeal, for the website and the desktop app (which calls this rather than ITAD, so
// the key never leaves the server).
//   GET /api/history?ids=10,20,30&cc=US          Steam all-time low per game (up to 200 games)
//   GET /api/history?id=10&cc=US&points=1        that, plus the game's Steam price log for the last year
// → { enabled, source, items: { [appid]: { low: {cents, regularCents, cut, at, currency} | null, points?: [...] } } }
//
// Prices barely change, and one free key serves everyone, so everything is cached for days: whole responses at
// Vercel's edge, and each game separately in Redis (so overlapping requests from different visitors share it).
// Without ITAD_API_KEY the endpoint reports enabled:false and the UI shows no history at all.
const itad = require("./_lib/itad.js");
const { redisClient } = require("./_lib/redis.js");
const { send, handler, storeParams, HttpError } = require("./_lib/server.js");

const DAY = 86400;
const LOW_TTL = 3 * DAY;
const POINTS_TTL = 2 * DAY;
const ID_TTL = 30 * DAY;
// A year of log, so the 90-day window knows the price that was already in force when it opened.
const POINTS_DAYS = 365;
const MAX_IDS = 200;
const NONE = "-"; // cached "IsThereAnyDeal doesn't know this game"

const key = {
  id: (appid) => `hist:id:${appid}`,
  low: (cc, appid) => `hist:low:${cc}:${appid}`,
  points: (cc, appid) => `hist:pts:${cc}:${appid}`,
};

function parseIds(q) {
  const raw = q.id != null ? String(q.id) : String(q.ids || "");
  const ids = [...new Set(raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length || ids.length > MAX_IDS) throw new HttpError(400, `Send between 1 and ${MAX_IDS} app ids.`, "bad_input");
  return ids;
}

/** Read cached values for `keys`; returns an array (undefined = not cached, null = cached "nothing"). */
async function cached(db, keys) {
  if (!db || !keys.length) return keys.map(() => undefined);
  const vals = await db.command("MGET", ...keys).catch(() => keys.map(() => null));
  return vals.map((v) => (v == null ? undefined : v === NONE ? null : JSON.parse(v)));
}

async function store(db, entries, ttl) {
  if (!db || !entries.length) return;
  await db.pipeline(entries.map(([k, v]) => ["SET", k, v == null ? NONE : JSON.stringify(v), "EX", ttl])).catch(() => {});
}

/** appid → ITAD id (null when unknown), using the cache first. */
async function itadIds(db, appids) {
  const hit = await cached(db, appids.map(key.id));
  const out = new Map(appids.map((a, i) => [a, hit[i]]));
  const missing = appids.filter((a) => out.get(a) === undefined);
  if (missing.length) {
    const found = await itad.lookupIds(missing);
    for (const a of missing) out.set(a, found.get(a) ?? null);
    await store(db, missing.map((a) => [key.id(a), out.get(a)]), ID_TTL);
  }
  return out;
}

async function lows(db, cc, appids) {
  const hit = await cached(db, appids.map((a) => key.low(cc, a)));
  const out = new Map(appids.map((a, i) => [a, hit[i]]));
  const missing = appids.filter((a) => out.get(a) === undefined);
  if (missing.length) {
    const ids = await itadIds(db, missing);
    const known = missing.filter((a) => ids.get(a));
    const byId = known.length ? await itad.steamLows(known.map((a) => ids.get(a)), cc) : new Map();
    for (const a of missing) out.set(a, ids.get(a) ? byId.get(ids.get(a)) ?? null : null);
    await store(db, missing.map((a) => [key.low(cc, a), out.get(a)]), LOW_TTL);
  }
  return out;
}

async function points(db, cc, appid) {
  const [hit] = await cached(db, [key.points(cc, appid)]);
  if (hit !== undefined) return hit;
  const id = (await itadIds(db, [appid])).get(appid);
  const pts = id ? await itad.steamHistory(id, cc, Date.now() - POINTS_DAYS * DAY * 1000) : null;
  await store(db, [[key.points(cc, appid), pts]], POINTS_TTL);
  return pts;
}

module.exports = handler(async (req, res) => {
  if (!itad.configured()) return send(res, 200, { enabled: false, items: {} }, { cache: "public, max-age=600, s-maxage=600" });
  const q = req.query || {};
  const appids = parseIds(q);
  const { country } = storeParams(q);
  const db = redisClient({ message: "Price history is unavailable right now.", code: "history_down" });

  const items = {};
  for (const [appid, low] of await lows(db, country, appids)) items[appid] = { low };
  const withPoints = q.points === "1" && appids.length === 1;
  if (withPoints) items[appids[0]].points = await points(db, country, appids[0]);

  const ttl = withPoints ? POINTS_TTL : LOW_TTL;
  send(res, 200, { enabled: true, source: "IsThereAnyDeal", items }, { cache: `public, max-age=3600, s-maxage=${ttl}, stale-while-revalidate=${7 * DAY}` });
});
