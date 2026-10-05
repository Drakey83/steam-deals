// Price history for the desktop app: from the website's /api/history (which holds the IsThereAnyDeal key; the
// app never calls IsThereAnyDeal itself), kept per game in the local cache for days, since it barely changes.
const settings = require("../settings");
const cache = require("../cache");
const { SITE } = require("../site");
const { handle } = require("./handle");

const LOW_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const POINTS_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_IDS = 200;
// While the website reports history as switched off (no key yet), don't ask again for a while.
const DISABLED_RETRY_MS = 30 * 60 * 1000;
let disabledUntil = 0;

const lowKey = (cc, appid) => `history:low:v1:${cc}:${appid}`;
const pointsKey = (cc, appid) => `history:points:v1:${cc}:${appid}`;

async function fromSite(params) {
  const res = await fetch(`${SITE}/api/history?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || "Price history is unavailable right now."), { code: data?.error?.code || "history" });
  return data;
}

/** { appids, points } → { enabled, source, items: { [appid]: { low, points? } } } */
async function getHistory({ appids = [], points = false } = {}) {
  const cc = settings.get().country || "US";
  const ids = [...new Set(appids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, MAX_IDS);
  if (!ids.length) return { enabled: true, items: {} };
  if (Date.now() < disabledUntil) return { enabled: false, items: {} };

  const items = {};
  const missing = [];
  for (const appid of ids) {
    const low = cache.get(lowKey(cc, appid), LOW_TTL_MS);
    const pts = points ? cache.get(pointsKey(cc, appid), POINTS_TTL_MS) : null;
    if (low && (!points || pts)) items[appid] = points ? { low: low.value, points: pts.value } : { low: low.value };
    else missing.push(appid);
  }
  if (missing.length) {
    const data = points && ids.length === 1 ? await fromSite({ id: ids[0], cc, points: "1" }) : await fromSite({ ids: missing.join(","), cc });
    if (data.enabled === false) {
      disabledUntil = Date.now() + DISABLED_RETRY_MS;
      return { enabled: false, items: {} };
    }
    for (const [appid, entry] of Object.entries(data.items || {})) {
      cache.set(lowKey(cc, appid), entry.low ?? null);
      if ("points" in entry) cache.set(pointsKey(cc, appid), entry.points ?? null);
      items[appid] = entry;
    }
  }
  return { enabled: true, source: "IsThereAnyDeal", items };
}

function register() {
  handle("history:get", getHistory);
}

module.exports = { register };
