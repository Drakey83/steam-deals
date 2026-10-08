// Everything a device sends the relay is cleaned to a known shape and size before it's stored: the relay keeps game
// ids, names and prices, alert targets, tag ids and filter choices, nothing else.
const MAX_ITEMS = 100;
const MAX_ALERTS = 200;

const str = (v, max) => String(v ?? "").slice(0, max);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : 0);
const intOrNull = (v) => (Number.isInteger(Number(v)) && v !== null && v !== "" ? Number(v) : null);

const parse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

/** A game's art address, kept only if it's on one of Steam's own image servers (https, *.steamstatic.com). */
function steamImage(v) {
  const s = str(v, 300);
  try {
    const u = new URL(s);
    return u.protocol === "https:" && /\.steamstatic\.com$/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

/** One basket game. */
function cleanItem(i) {
  const appid = int(i?.appid);
  if (appid <= 0) return null;
  const packageid = int(i?.packageid);
  return {
    appid,
    packageid: packageid > 0 ? packageid : null,
    name: str(i?.name, 120),
    price: str(i?.price, 30) || null,
    priceCents: Math.max(0, int(i?.priceCents)) || null,
    originalCents: Math.max(0, int(i?.originalCents)) || null,
    discount: Math.min(100, Math.max(0, int(i?.discount))),
    // Only Steam's own image servers: the art path Steam listed for the game.
    image: steamImage(i?.image),
  };
}
const emptyBasket = () => ({ rev: 0, items: [], updatedAt: 0, by: null });

/** One price alert, in the shape of src/renderer/logic/alerts.js (plus origin "web"). */
function cleanAlert(a) {
  const appid = int(a?.appid);
  const targetCents = int(a?.targetCents);
  const country = str(a?.country, 2).toUpperCase();
  if (appid <= 0 || targetCents <= 0 || !/^[A-Z]{2}$/.test(country)) return null;
  return {
    appid,
    name: str(a?.name, 120),
    country,
    targetCents,
    priceSample: str(a?.priceSample, 30) || null,
    armed: Boolean(a?.armed),
    createdAt: int(a?.createdAt) || 0,
    lastCents: intOrNull(a?.lastCents),
    triggeredAt: intOrNull(a?.triggeredAt),
    triggeredCents: intOrNull(a?.triggeredCents),
    seen: a?.seen !== false,
    origin: "web",
  };
}

/** A list of alerts: one per game + region + target, at most MAX_ALERTS. */
function cleanAlerts(list) {
  const seen = new Set();
  const out = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, MAX_ALERTS * 2).map(cleanAlert)) {
    const key = a && `${a.appid}:${a.country}:${a.targetCents}`;
    if (!a || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.slice(0, MAX_ALERTS);
}

// Shared preferences (filters, "Your taste" edits, Not interested, behaviour): the same cleaning every device uses.
// The website build copies src/shared/sharing.js next to this folder; before a build (unit tests) the source is used.
const Sharing = (() => {
  try {
    return require("../sharing.js");
  } catch {
    return require("../../../../src/shared/sharing.js");
  }
})();
const cleanPrefs = Sharing.cleanPrefs;

module.exports = { MAX_ITEMS, str, int, parse, cleanItem, emptyBasket, cleanAlerts, cleanPrefs };
