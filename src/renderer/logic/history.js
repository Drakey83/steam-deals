// Price history maths. Pure: no DOM, no network (unit-tested).
// Input comes from window.steamDeals.history.get (IsThereAnyDeal data via /api/history):
//   entry = { low: { cents, regularCents, cut, at, currency } | null, points?: [{ at, cents, regularCents, cut }] }
// Nothing here ever invents a number: every result is null unless real data backs it.

export const WINDOW_DAYS = 90;
const DAY_MS = 86400000;

/**
 * Is the current price the lowest Steam has ever charged (per IsThereAnyDeal)? Only with a recorded low and a
 * known current price. "new" when it's below the old record, "matches" when it equals it.
 */
export function lowestEver(entry, priceCents) {
  const low = entry?.low;
  if (!low || !Number.isFinite(low.cents) || !Number.isFinite(priceCents) || priceCents <= 0) return null;
  if (priceCents < low.cents) return { kind: "new", previousCents: low.cents, previousAt: low.at };
  if (priceCents === low.cents) return { kind: "matches", previousCents: low.cents, previousAt: low.at };
  return null;
}

/**
 * The last WINDOW_DAYS from the price log: the lowest price, and the typical sale (the time-weighted median
 * discount while on sale, plus how much of the time it was on sale). null without points in the window.
 * Each point is a price change; a price holds until the next point (or `now`). The price in force when the
 * window opened counts from the window's start.
 */
export function summarizeWindow(points, now = Date.now(), days = WINDOW_DAYS) {
  const start = now - days * DAY_MS;
  const sorted = (points || []).filter((p) => Number.isFinite(p.at) && Number.isFinite(p.cents)).sort((a, b) => a.at - b.at);
  if (!sorted.length) return null;
  const inForceAtStart = [...sorted].reverse().find((p) => p.at <= start);
  const relevant = [...(inForceAtStart ? [{ ...inForceAtStart, at: start }] : []), ...sorted.filter((p) => p.at > start && p.at <= now)];
  if (!relevant.length) return null;

  let low = relevant[0];
  const segments = relevant.map((p, i) => {
    if (p.cents < low.cents) low = p;
    const end = i + 1 < relevant.length ? relevant[i + 1].at : now;
    return { cut: p.cut || 0, ms: Math.max(0, end - p.at) };
  });
  const total = segments.reduce((s, x) => s + x.ms, 0);
  const onSale = segments.filter((x) => x.cut > 0);
  const saleMs = onSale.reduce((s, x) => s + x.ms, 0);
  return {
    lowCents: low.cents,
    lowAt: low.at,
    typicalCut: saleMs > 0 ? weightedMedian(onSale) : null,
    saleShare: total > 0 ? saleMs / total : 0,
    coveredDays: Math.round((now - relevant[0].at) / DAY_MS),
  };
}

function weightedMedian(segments) {
  const sorted = segments.slice().sort((a, b) => a.cut - b.cut);
  const half = sorted.reduce((s, x) => s + x.ms, 0) / 2;
  let acc = 0;
  for (const x of sorted) {
    acc += x.ms;
    if (acc >= half) return x.cut;
  }
  return sorted[sorted.length - 1].cut;
}

/** The badge a card may show, or null. Only "lowest ever", and only when the data says so. */
export const historyBadge = (entry, priceCents) => (lowestEver(entry, priceCents) ? "lowest-ever" : null);
