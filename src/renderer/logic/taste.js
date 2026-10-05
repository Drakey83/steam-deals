// The For-you taste model. Pure: no DOM, no network (unit-tested).
//
// Tag "lift": how much more the person's library leans into a tag than the scanned catalog does.
// Ubiquitous tags (Singleplayer, Indie…) end up near zero; distinctive tastes (Roguelike, Souls-like,
// Farming Sim…) end up strongly positive or negative.

const EPS = 1e-4;
const SIMILAR_MIN = 0.28;

/**
 * @param {{affinity:Object<string,number>, anchors?:Array}} taste  profile built from the library
 * @param {object[]} deals  the scanned items (their tag weights form the baseline)
 * @returns model with raw(), contributions(), similar() and topTags, or null without a profile
 */
export function buildTasteModel(taste, deals) {
  if (!taste || !taste.affinity) return null;
  const base = new Map();
  for (const d of deals) for (const tg of d.tags || []) base.set(tg.id, (base.get(tg.id) || 0) + tg.w);
  const n = deals.length || 1;

  const lift = new Map();
  const ids = new Set([...Object.keys(taste.affinity).map(Number), ...base.keys()]);
  for (const id of ids) {
    const a = (taste.affinity[id] || 0) + EPS;
    const b = (base.get(id) || 0) / n + EPS;
    lift.set(id, Math.max(-2.5, Math.min(3, Math.log2(a / b))));
  }

  const topTags = Object.entries(taste.affinity)
    .map(([id, a]) => ({ id: Number(id), score: a * Math.max(0, lift.get(Number(id)) ?? 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((x) => x.id);

  const anchorVecs = (taste.anchors || []).map((a) => {
    const m = new Map(a.tags.map((tg) => [tg.id, tg.w]));
    const norm = Math.sqrt([...m.values()].reduce((s, w) => s + w * w, 0)) || 1;
    return { ...a, m, norm };
  });

  return {
    deals,
    lift,
    topTags,
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
