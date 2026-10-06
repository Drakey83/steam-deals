// What paired devices share, and how two copies are merged: price alerts made on the website, and hand edits
// to "Your taste". Pure, no I/O. Used by the Windows app's sync engine (src/main/sync/) and the website's sync code
// (web/src/browser-api/). Loads as CommonJS where `module` exists, otherwise as window.SteamSharing.
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

const api = { cleanTasteTags, mergeTasteTags, sameTasteTags, alertKey, withoutWebAlerts, mergeWebAlerts, webAlertsForRelay, tagWebAlerts, rebaseWebAlerts, sameAlerts, MAX_SHARED_ALERTS };
if (typeof module === "object" && module.exports) module.exports = api;
else root.SteamSharing = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
