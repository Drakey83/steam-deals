// "Not interested": the games the person dismissed. Pure: no DOM, no network (unit-tested).
//
// Each entry keeps the game's tags as they were when dismissed, so the dismissal keeps shaping the taste
// model even when the game is no longer in the scanned deals.

/** At most this many dismissals are kept (oldest dropped first); plenty for a person, small in settings. */
export const MAX_DISMISSED = 500;
const MAX_TAGS = 10;

/** The entry stored for a dismissed game. */
export function dismissEntry(d, now = Date.now()) {
  const tags = (d.tags || [])
    .slice()
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_TAGS)
    .map((t) => ({ id: t.id, w: Math.round(t.w * 1000) / 1000 }));
  return { appid: d.appid, name: d.name || `App ${d.appid}`, tags, at: now };
}

/** Add a dismissal (moving an existing one to the front); capped at MAX_DISMISSED. */
export function addDismissed(list, d, now = Date.now()) {
  const rest = (list || []).filter((x) => x.appid !== d.appid);
  return [dismissEntry(d, now), ...rest].slice(0, MAX_DISMISSED);
}

export const removeDismissed = (list, appid) => (list || []).filter((x) => x.appid !== appid);

export const dismissedIds = (list) => new Set((list || []).map((x) => x.appid));

/**
 * What the dismissed games have in common: tag id → { weight, share }. `weight` is the tag's mean weight across
 * the dismissed games (the taste model compares it with the catalog, so only distinctive tags count); `share` is
 * the fraction of dismissed games that carry the tag, so a theme they share (two roguelikes) counts for more than
 * something only one of them had (one of them was also a shooter).
 */
export function negativeProfile(list) {
  const out = new Map();
  const n = (list || []).length;
  if (!n) return out;
  for (const x of list) {
    for (const t of x.tags || []) {
      const cur = out.get(t.id) || { weight: 0, share: 0 };
      out.set(t.id, { weight: cur.weight + t.w / n, share: cur.share + 1 / n });
    }
  }
  return out;
}
