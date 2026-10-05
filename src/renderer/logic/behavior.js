// Learning from what the person does in the app. Pure: no DOM, no network (unit-tested).
//
// Implicit events (opened a game, put it in the basket, dismissed it, came to own it) are kept in a bounded log.
// Each event carries the game's tags, so it keeps counting after the game leaves the deals. The log becomes a
// time-decayed tag signal that is blended into the library-based affinity, but only ever as a minority share:
// what someone actually plays stays the main evidence.

/** How much each kind of event says about taste (negative = "less of this"). */
export const EVENT_WEIGHTS = Object.freeze({
  opened: 0.5, // looked at the details: mild interest
  basket: 1.5, // put it in the basket: real intent
  owned: 3, // came to own a game they'd looked at or basketed: the strongest positive
  dismissed: -1.5, // "Not interested" (the explicit dismiss list also pushes these tags down, until restored)
});
export const MAX_EVENTS = 300;
/** An event's weight halves every HALF_LIFE_DAYS, so recent behaviour counts most. */
export const HALF_LIFE_DAYS = 30;
/** The behaviour signal never makes up more than this share of the blended affinity. */
export const MAX_BEHAVIOR_SHARE = 0.35;
/** Evidence (sum of decayed |weights|) at which the share reaches ~63% of the maximum. */
const EVIDENCE_SCALE = 10;
/** The same game opened again within this window is one event, not many. */
const REPEAT_WINDOW_MS = 60 * 60 * 1000;
const MAX_TAGS = 10;
const DAY_MS = 86400000;

const compactTags = (tags) =>
  (tags || [])
    .slice()
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_TAGS)
    .map((t) => ({ id: t.id, w: Math.round(t.w * 1000) / 1000 }));

/** Append an event (newest first), dropping quick repeats of the same event and keeping at most MAX_EVENTS. */
export function recordEvent(events, type, d, now = Date.now()) {
  if (!(type in EVENT_WEIGHTS) || !d?.appid) return events || [];
  const list = events || [];
  const repeat = list.find((e) => e.appid === d.appid && e.type === type);
  if (repeat && (type === "owned" || now - repeat.at < REPEAT_WINDOW_MS)) return list; // owned counts once ever
  return [{ type, appid: d.appid, tags: compactTags(d.tags), at: now }, ...list].slice(0, MAX_EVENTS);
}

/**
 * Add an "owned" event for each game the person opened or basketed in the app and now owns (they bought it).
 * Uses the tags stored with the earlier event. Returns the new event list (unchanged if nothing new).
 */
export function newlyOwned(events, owned, now = Date.now()) {
  const already = new Set((events || []).filter((e) => e.type === "owned").map((e) => e.appid));
  const out = [];
  const seen = new Set();
  for (const e of events || []) {
    if ((e.type !== "opened" && e.type !== "basket") || already.has(e.appid) || seen.has(e.appid) || !owned.has(e.appid)) continue;
    seen.add(e.appid);
    out.push({ appid: e.appid, tags: e.tags });
  }
  return out.reduce((list, d) => recordEvent(list, "owned", d, now), events || []);
}

export const decay = (ageMs) => Math.pow(0.5, Math.max(0, ageMs) / (HALF_LIFE_DAYS * DAY_MS));

/** The decayed behaviour signal: tag id → signed score, plus the total evidence behind it. */
export function behaviorSignal(events, now = Date.now()) {
  const scores = new Map();
  let evidence = 0;
  for (const e of events || []) {
    const w = (EVENT_WEIGHTS[e.type] || 0) * decay(now - e.at);
    if (!w) continue;
    evidence += Math.abs(w);
    for (const t of e.tags || []) scores.set(t.id, (scores.get(t.id) || 0) + w * t.w);
  }
  return { scores, evidence };
}

/** How much of the blended affinity comes from behaviour: grows with evidence, never above MAX_BEHAVIOR_SHARE. */
export const behaviorShare = (evidence) => MAX_BEHAVIOR_SHARE * (1 - Math.exp(-evidence / EVIDENCE_SCALE));

/**
 * Blend the library affinity (tag id → weight, sums to ~1) with the behaviour signal. Positive behaviour adds
 * weight to its tags, negative behaviour removes weight (never below zero), and the library always keeps at
 * least (1 - MAX_BEHAVIOR_SHARE) of the say. With no events the library affinity comes back unchanged.
 */
export function blendAffinity(affinity, events, now = Date.now()) {
  const { scores, evidence } = behaviorSignal(events, now);
  if (!scores.size || evidence <= 0) return affinity;
  const share = behaviorShare(evidence);
  const total = [...scores.values()].reduce((s, v) => s + Math.abs(v), 0) || 1;
  const out = {};
  for (const [id, a] of Object.entries(affinity || {})) out[id] = (1 - share) * a;
  for (const [id, v] of scores) out[id] = Math.max(0, (out[id] || 0) + (share * v) / total);
  return out;
}

/** The taste profile with behaviour blended in (same shape; null stays null). */
export function withBehavior(taste, events, now = Date.now()) {
  if (!taste || !taste.affinity || !(events || []).length) return taste;
  return { ...taste, affinity: blendAffinity(taste.affinity, events, now) };
}
