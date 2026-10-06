// The For-you taste model. Pure: no DOM, no network (unit-tested).
//
// Tag "lift": how much more the person's library leans into a tag than the scanned catalog does.
// Ubiquitous tags (Singleplayer, Indie…) end up near zero; distinctive tastes (Roguelike, Souls-like,
// Farming Sim…) end up strongly positive or negative.

import { negativeProfile } from "./dismiss.js";

const EPS = 1e-4;
const SIMILAR_MIN = 0.28;
const LIFT_MIN = -2.5;
const LIFT_MAX = 3;
// Dismissals subtract after the library's own clamp, so they still count for tags the library already dislikes.
const LIFT_FLOOR = LIFT_MIN - 4;
// "Not interested": how hard a dismissed game's distinctive tags are pushed down. An explicit dismissal is a
// stronger signal than what the library implies, so two dismissals sharing a tag can outweigh a liked tag: full
// strength after DISMISS_FULL_AFTER dismissals, at most DISMISS_STRENGTH * 4 lift units. Tags as common in the
// dismissed games as in the catalog (Singleplayer…) are untouched.
const DISMISS_STRENGTH = 1;
const DISMISS_FULL_AFTER = 2;
// Tags the person put in or took out of "Your taste" by hand. An added tag counts like a strong learned taste
// (well above most, below the very top); a removed one stops pushing games up but isn't held against them
// (dismissals still can). Hand edits beat what the library implies.
export const ADDED_LIFT = 2;
export const MAX_TASTE_EDITS = 60;
const TOP_TAGS = 12;

const tagIds = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_TASTE_EDITS);

/** settings.tasteTags → { added:[tagid], removed:[tagid] } (anything odd dropped). */
export const normalizeTasteEdits = (e) => ({ added: tagIds(e?.added), removed: tagIds(e?.removed) });

/** Put a tag in "Your taste" (and take it off the removed list). */
export function addTasteTag(edits, id) {
  const e = normalizeTasteEdits(edits);
  return { added: e.added.includes(id) ? e.added : [...e.added, id].slice(-MAX_TASTE_EDITS), removed: e.removed.filter((x) => x !== id) };
}

/**
 * Take a tag out of "Your taste". A tag the person added just goes away; one the library taught is remembered as
 * removed (so it stays out after the next rebuild), and can be restored.
 */
export function removeTasteTag(edits, id, learned) {
  const e = normalizeTasteEdits(edits);
  const added = e.added.filter((x) => x !== id);
  const removed = learned && !e.removed.includes(id) ? [...e.removed, id].slice(-MAX_TASTE_EDITS) : e.removed;
  return { added, removed };
}

/** Undo a removal: the tag counts as the library says again. */
export function restoreTasteTag(edits, id) {
  const e = normalizeTasteEdits(edits);
  return { added: e.added, removed: e.removed.filter((x) => x !== id) };
}

/**
 * @param {{affinity:Object<string,number>, anchors?:Array}} taste  profile built from the library
 * @param {object[]} deals  the scanned items (their tag weights form the baseline)
 * @param {object[]} [dismissed]  "Not interested" entries (logic/dismiss.js); their distinctive tags count against
 * @param {{added?:number[], removed?:number[]}} [edits]  tags put in or taken out of "Your taste" by hand
 * @returns model with raw(), contributions(), similar(), topTags (after edits) and learnedTags (before), or null
 */
export function buildTasteModel(taste, deals, dismissed = [], edits = {}) {
  if (!taste || !taste.affinity) return null;
  const base = new Map();
  for (const d of deals) for (const tg of d.tags || []) base.set(tg.id, (base.get(tg.id) || 0) + tg.w);
  const n = deals.length || 1;

  const neg = negativeProfile(dismissed);
  const confidence = Math.min(1, dismissed.length / DISMISS_FULL_AFTER);
  const lift = new Map();
  const ids = new Set([...Object.keys(taste.affinity).map(Number), ...base.keys(), ...neg.keys()]);
  for (const id of ids) {
    const b = (base.get(id) || 0) / n + EPS;
    const liked = Math.log2(((taste.affinity[id] || 0) + EPS) / b);
    const d = neg.get(id);
    const disliked = d ? d.share * Math.max(0, Math.min(4, Math.log2((d.weight + EPS) / b))) : 0;
    const fromLibrary = Math.max(LIFT_MIN, Math.min(LIFT_MAX, liked));
    lift.set(id, Math.max(LIFT_FLOOR, fromLibrary - DISMISS_STRENGTH * confidence * disliked));
  }

  const signature = () => Object.entries(taste.affinity)
    .map(([id, a]) => ({ id: Number(id), score: a * Math.max(0, lift.get(Number(id)) ?? 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_TAGS)
    .map((x) => x.id);
  const learnedTags = signature(); // what the library alone says, before hand edits

  const { added, removed } = normalizeTasteEdits(edits);
  for (const id of removed) lift.set(id, Math.min(0, lift.get(id) ?? 0));
  for (const id of added) lift.set(id, Math.max(ADDED_LIFT, lift.get(id) ?? 0));
  const addedSet = new Set(added);
  const learnedKept = signature().filter((id) => !addedSet.has(id));
  const topTags = [...added, ...learnedKept].slice(0, Math.max(TOP_TAGS, added.length));

  const anchorVecs = (taste.anchors || []).map((a) => {
    const m = new Map(a.tags.map((tg) => [tg.id, tg.w]));
    const norm = Math.sqrt([...m.values()].reduce((s, w) => s + w * w, 0)) || 1;
    return { ...a, m, norm };
  });

  return {
    deals,
    lift,
    topTags,
    learnedTags,
    added: addedSet,
    removed: new Set(removed),
    /** How strongly a game's tags line up with the person's taste (unbounded; ranking z-scores it). */
    raw: (d) => (d.tags || []).reduce((s, tg) => s + tg.w * (lift.get(tg.id) ?? 0), 0),
    /** Each tag's share of raw(), strongest first. */
    contributions: (d) => (d.tags || []).map((tg) => ({ id: tg.id, v: tg.w * (lift.get(tg.id) ?? 0) })).sort((a, b) => b.v - a.v),
    /** The owned games this one most resembles ("because you played …"). */
    similar: (d, k = 2) => {
      const dn = Math.sqrt((d.tags || []).reduce((s, tg) => s + tg.w * tg.w, 0)) || 1;
      return anchorVecs
        .map((a) => ({ name: a.name, hours: a.hours, appid: a.appid, sim: (d.tags || []).reduce((s, tg) => s + tg.w * (a.m.get(tg.id) || 0), 0) / (dn * a.norm) }))
        .filter((x) => x.sim >= SIMILAR_MIN && x.appid !== d.appid)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, k);
    },
  };
}
