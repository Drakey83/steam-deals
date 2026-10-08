// What paired devices share, and how two copies are merged: price alerts made on the website, and the shared
// preferences (filters, "Your taste" edits, Not interested, behaviour). Pure, no I/O. Also cleans what the relay
// stores (the website build copies this file to web/api/_lib/). Used by the Windows app's sync engine
// (src/main/sync/), the website's sync code (web/src/browser-api/) and the relay. Loads as CommonJS where `module` exists, otherwise as window.SteamSharing.
(function (root) {
// ----- price alerts shared through the pairing relay -----
// The alert shape is the one in src/renderer/logic/alerts.js, plus `origin: "web"` on alerts made on the website.
// The relay holds the website's alerts. The paired Windows app adds them to its own list and is the one that
// checks them and notifies, so the state fields (armed, lastCents, triggered…) are the app's to set; the website
// decides which alerts exist and at what price.
const ALERT_STATE = ["armed", "lastCents", "triggeredAt", "triggeredCents"];
const MAX_SHARED_ALERTS = 200;

/** Two alerts are the same alert when game, store region and target price match. */
const alertKey = (a) => `${a?.appid}:${a?.country}:${a?.targetCents}`;
const isWebAlert = (a) => a?.origin === "web";
const pick = (a, keys) => Object.fromEntries(keys.map((k) => [k, a[k]]));

/** Newest first, one per key, at most `max`. */
function dedupeAlerts(list, max = MAX_SHARED_ALERTS) {
  const seen = new Set();
  const out = [];
  for (const a of [...(list || [])].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))) {
    const k = alertKey(a);
    if (!a || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.slice(0, max);
}

/**
 * Windows app: the relay's (website) alerts merged into this app's list. The website decides which web alerts
 * exist; this app keeps its own check state for ones it already had. A local alert identical to a web one is
 * dropped in favour of the web one, so its state flows back to the website.
 */
function mergeWebAlerts(local, remote, max = MAX_SHARED_ALERTS) {
  const mine = new Map((local || []).filter(isWebAlert).map((a) => [alertKey(a), a]));
  const web = (remote || []).map((r) => {
    const had = mine.get(alertKey(r));
    return had ? { ...r, ...pick(had, [...ALERT_STATE, "seen"]), origin: "web" } : { ...r, origin: "web" };
  });
  const webKeys = new Set(web.map(alertKey));
  const own = (local || []).filter((a) => !isWebAlert(a) && !webKeys.has(alertKey(a)));
  return dedupeAlerts([...web, ...own], max);
}

/**
 * Windows app: what to write back to the relay, i.e. this app's copies of the web alerts. An alert this app fired
 * (its trigger differs from the relay's) goes back as seen: the Windows notification was the one notice, so the
 * website's bell doesn't announce it a second time. Otherwise the website's own "seen" stands.
 */
function webAlertsForRelay(local, remote) {
  const theirs = new Map((remote || []).map((r) => [alertKey(r), r]));
  return dedupeAlerts((local || []).filter(isWebAlert).map((a) => {
    const r = theirs.get(alertKey(a));
    const firedHere = a.triggeredAt && a.triggeredAt !== r?.triggeredAt;
    return { ...a, seen: firedHere ? true : r ? Boolean(r.seen) : a.seen !== false };
  }));
}

/** Website: its alert list as it goes to the relay, each marked as made on the website. */
const tagWebAlerts = (list) => dedupeAlerts((list || []).map((a) => (isWebAlert(a) ? a : { ...a, origin: "web" })));

/**
 * Website, when the relay changed under it: keep this browser's choice of alerts and targets, take the check
 * state from the relay (the Windows app's, which is newer) for alerts both have.
 */
function rebaseWebAlerts(mine, remote) {
  const theirs = new Map((remote || []).map((r) => [alertKey(r), r]));
  return tagWebAlerts((mine || []).map((a) => {
    const r = theirs.get(alertKey(a));
    return r ? { ...a, ...pick(r, ALERT_STATE), seen: Boolean(a.seen || r.seen) } : a;
  }));
}

/** Windows app, when the pairing ends: website alerts go back to the website (it checks them itself again). */
const withoutWebAlerts = (list) => (list || []).filter((a) => !isWebAlert(a));

// ----- "Your taste" edits shared through the relay -----
// settings.tasteTags = { added:[tagid], removed:[tagid], at } (logic/taste.js reads added/removed). The most
// recent change wins. When two devices first pair, nothing is thrown away: both sides' edits are combined
// (a tag added on either side counts as added).
const tasteIds = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 60);
const cleanTasteTags = (t) => ({ added: tasteIds(t?.added), removed: tasteIds(t?.removed), at: Math.max(0, Number(t?.at) || 0) });

function mergeTasteTags(local, remote, { combine = false } = {}) {
  const a = cleanTasteTags(local);
  const b = cleanTasteTags(remote);
  if (!combine && a.at !== b.at) return a.at > b.at ? a : b;
  const added = [...new Set([...a.added, ...b.added])].slice(0, 60);
  const removed = [...new Set([...a.removed, ...b.removed])].filter((id) => !added.includes(id)).slice(0, 60);
  return { added, removed, at: Math.max(a.at, b.at) };
}
const sameTasteTags = (a, b) => JSON.stringify(cleanTasteTags(a)) === JSON.stringify(cleanTasteTags(b));

/** Same alerts, same targets, same state? (Skips writes that would change nothing.) */
const canonicalAlerts = (list) => JSON.stringify(dedupeAlerts(list).map((a) => Object.keys(a).sort().map((k) => [k, a[k] ?? null])));
const sameAlerts = (a, b) => canonicalAlerts(a) === canonicalAlerts(b);

// ----- the shared preferences document -----
// Everything that decides what the list shows and how "Your taste" comes out is the same on every paired device:
//   tasteTags          hand edits to Your taste (above)
//   filters            { values, at }: the view, sale/all, sort, sidebar filters, scan depth, score weights.
//                      The most recent change wins, as one set (settings.filtersAt stamps local changes).
//   dismissed          "Not interested", plus `restored` [{appid, at}] so an undo on one device isn't brought back
//                      by another; per game, the newest dismiss or restore wins.
//   behavior           what the person did (logic/behavior.js), the union of every device's events, newest first;
//                      `behaviorClearedAt` forgets everything older ("Reset my recommendations").
// Store region and language stay per device (a phone abroad), as do panel and window choices.
const FILTER_KEYS = ["view", "catalog", "sort", "minDiscount", "minRating", "minReviews", "scanDepth", "weights", "personalWeight", "hideOwned", "wishlistOnly", "selectedTags", "deckMachineOnly"];
const SORT_VALUES = ["match", "score", "discount", "rating", "reviews", "price", "name"];
const MAX_DISMISSED = 500;
const MAX_EVENTS = 300;
const EVENT_TYPES = ["opened", "basket", "owned", "dismissed"];

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const intIn = (v, lo, hi) => (Number.isFinite(num(v)) ? Math.min(hi, Math.max(lo, Math.round(num(v)))) : undefined);
const time = (v) => Math.max(0, Math.round(num(v)) || 0);

/** One filter value, or undefined when it isn't a valid one. */
const FILTER_CLEAN = {
  view: (v) => (v === "foryou" || v === "all" ? v : undefined),
  catalog: (v) => (v === "sale" || v === "all" ? v : undefined),
  sort: (v) => (SORT_VALUES.includes(v) ? v : undefined),
  minDiscount: (v) => intIn(v, 0, 95),
  minRating: (v) => intIn(v, 0, 100),
  minReviews: (v) => intIn(v, 0, 10000000),
  scanDepth: (v) => intIn(v, 0, 1000000),
  personalWeight: (v) => intIn(v, 0, 100),
  weights: (v) => {
    if (!v || typeof v !== "object") return undefined;
    const w = { discount: intIn(v.discount, 0, 100), rating: intIn(v.rating, 0, 100), popularity: intIn(v.popularity, 0, 100) };
    return Object.values(w).every((x) => x !== undefined) ? w : undefined;
  },
  hideOwned: (v) => (typeof v === "boolean" ? v : undefined),
  wishlistOnly: (v) => (typeof v === "boolean" ? v : undefined),
  deckMachineOnly: (v) => (typeof v === "boolean" ? v : undefined),
  selectedTags: (v) => (Array.isArray(v) ? tasteIds(v) : undefined),
};

function cleanFilters(f) {
  const values = {};
  for (const k of FILTER_KEYS) {
    const v = FILTER_CLEAN[k](f?.values?.[k]);
    if (v !== undefined) values[k] = v;
  }
  return { values, at: time(f?.at) };
}

const cleanTagWeights = (tags) => (Array.isArray(tags) ? tags : []).slice(0, 10).map((t) => ({ id: intIn(t?.id, 1, 1e9), w: Math.round((num(t?.w) || 0) * 1000) / 1000 })).filter((t) => t.id);
const byNewest = (a, b) => b.at - a.at;

function cleanDismissed(list) {
  const seen = new Set();
  const out = [];
  for (const d of Array.isArray(list) ? list : []) {
    const appid = intIn(d?.appid, 1, 1e9);
    if (!appid || seen.has(appid)) continue;
    seen.add(appid);
    out.push({ appid, name: String(d.name ?? `App ${appid}`).slice(0, 200), tags: cleanTagWeights(d.tags), at: time(d.at) });
  }
  return out.sort(byNewest).slice(0, MAX_DISMISSED);
}

function cleanRestored(list) {
  const newest = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    const appid = intIn(r?.appid, 1, 1e9);
    if (appid) newest.set(appid, Math.max(newest.get(appid) || 0, time(r.at)));
  }
  return [...newest].map(([appid, at]) => ({ appid, at })).sort(byNewest).slice(0, MAX_DISMISSED);
}

const eventKey = (e) => `${e.type}:${e.appid}:${e.at}`;
function cleanBehavior(list, clearedAt = 0) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const ev = { type: EVENT_TYPES.includes(e?.type) ? e.type : null, appid: intIn(e?.appid, 1, 1e9), tags: cleanTagWeights(e?.tags), at: time(e?.at) };
    if (!ev.type || !ev.appid || ev.at <= clearedAt || seen.has(eventKey(ev))) continue;
    seen.add(eventKey(ev));
    out.push(ev);
  }
  return out.sort(byNewest).slice(0, MAX_EVENTS);
}

/** The whole document in its known shape and size (the relay stores exactly this). */
function cleanPrefs(p) {
  const behaviorClearedAt = time(p?.behaviorClearedAt);
  return {
    tasteTags: cleanTasteTags(p?.tasteTags),
    filters: cleanFilters(p?.filters),
    dismissed: cleanDismissed(p?.dismissed),
    restored: cleanRestored(p?.restored),
    behavior: cleanBehavior(p?.behavior, behaviorClearedAt),
    behaviorClearedAt,
  };
}

/** This device's settings as the shared document. */
function prefsFromSettings(s) {
  const values = {};
  for (const k of FILTER_KEYS) if (s?.[k] !== undefined) values[k] = s[k];
  return cleanPrefs({
    tasteTags: s?.tasteTags,
    filters: { values, at: s?.filtersAt },
    dismissed: s?.dismissed,
    restored: s?.dismissRestored,
    behavior: s?.behavior,
    behaviorClearedAt: s?.behaviorClearedAt,
  });
}

/** The shared document as a settings patch (only what the document holds). */
function settingsFromPrefs(doc) {
  const p = cleanPrefs(doc);
  return { ...p.filters.values, filtersAt: p.filters.at, tasteTags: p.tasteTags, dismissed: p.dismissed, dismissRestored: p.restored, behavior: p.behavior, behaviorClearedAt: p.behaviorClearedAt };
}

/**
 * Two copies of the document as one. Filters: the newer set wins (a copy without any is ignored; on a tie this
 * device's stays). Not interested and behaviour: nothing is lost, see above. combine: devices pairing for the
 * first time (taste edits are combined rather than the newest winning).
 */
function mergePrefs(local, remote, { combine = false } = {}) {
  const a = cleanPrefs(local);
  const b = cleanPrefs(remote);
  const hasA = Object.keys(a.filters.values).length;
  const hasB = Object.keys(b.filters.values).length;
  const filters = !hasB ? a.filters : !hasA || b.filters.at > a.filters.at ? b.filters : a.filters;

  const restored = cleanRestored([...a.restored, ...b.restored]);
  const restoredAt = new Map(restored.map((r) => [r.appid, r.at]));
  const newestDismiss = new Map();
  for (const d of [...a.dismissed, ...b.dismissed]) if (!newestDismiss.has(d.appid) || d.at > newestDismiss.get(d.appid).at) newestDismiss.set(d.appid, d);
  const dismissed = cleanDismissed([...newestDismiss.values()].filter((d) => d.at > (restoredAt.get(d.appid) || 0)));

  const behaviorClearedAt = Math.max(a.behaviorClearedAt, b.behaviorClearedAt);
  return {
    tasteTags: mergeTasteTags(a.tasteTags, b.tasteTags, { combine }),
    filters,
    dismissed,
    restored: restored.filter((r) => !dismissed.some((d) => d.appid === r.appid)),
    behavior: cleanBehavior([...a.behavior, ...b.behavior], behaviorClearedAt),
    behaviorClearedAt,
  };
}
const samePrefs = (a, b) => JSON.stringify(cleanPrefs(a)) === JSON.stringify(cleanPrefs(b));

const sameValue = (x, y) => JSON.stringify(x) === JSON.stringify(y);
/**
 * A local settings change: what else to record so it reaches the other devices as a change. A filter that really
 * changed stamps filtersAt; games taken off "Not interested" get a restore mark; emptying the behaviour log marks
 * the reset. Returns extra settings fields (empty when there's nothing to add).
 */
function notePrefsEdit(before, patch, now = Date.now()) {
  const extra = {};
  if (FILTER_KEYS.some((k) => k in (patch || {}) && !sameValue(patch[k], before?.[k]))) extra.filtersAt = now;
  if (Array.isArray(patch?.dismissed)) {
    const still = new Set(patch.dismissed.map((d) => d?.appid));
    const gone = (before?.dismissed || []).filter((d) => !still.has(d?.appid)).map((d) => ({ appid: d.appid, at: now }));
    if (gone.length) extra.dismissRestored = cleanRestored([...gone, ...(before?.dismissRestored || [])]);
  }
  if (Array.isArray(patch?.behavior) && !patch.behavior.length && (before?.behavior || []).length) extra.behaviorClearedAt = now;
  return extra;
}
/** Settings keys that are part of the shared document (a change to any of them is shared). */
const PREFS_KEYS = new Set([...FILTER_KEYS, "tasteTags", "dismissed", "behavior"]);

const api = {
  cleanTasteTags, mergeTasteTags, sameTasteTags, alertKey, withoutWebAlerts, mergeWebAlerts, webAlertsForRelay, tagWebAlerts, rebaseWebAlerts, sameAlerts, MAX_SHARED_ALERTS,
  FILTER_KEYS, PREFS_KEYS, cleanPrefs, prefsFromSettings, settingsFromPrefs, mergePrefs, samePrefs, notePrefsEdit,
};
if (typeof module === "object" && module.exports) module.exports = api;
else root.SteamSharing = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
