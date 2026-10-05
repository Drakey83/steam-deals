// Filtering and ranking the deal list. Pure: no DOM, no network (unit-tested).

/** Valve's compatibility ratings for the Steam Deck and the Steam Machine: 3 = Verified, 2 = Playable. */
export const playsOnDeckOrMachine = (d) => (d.deck || 0) >= 2 || (d.machine || 0) >= 2;

/** Turn the three score weights into fractions that add up to 1. */
export function normWeights(w) {
  const d = Math.max(0, Number(w?.discount ?? 40));
  const r = Math.max(0, Number(w?.rating ?? 35));
  const p = Math.max(0, Number(w?.popularity ?? 25));
  const sum = d + r + p || 1;
  return { discount: d / sum, rating: r / sum, popularity: p / sum };
}

const SORTERS = {
  match: (a, b) => b.recScore - a.recScore,
  score: (a, b) => b.score - a.score,
  discount: (a, b) => b.discount - a.discount || b.recScore - a.recScore,
  rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviews - a.reviews,
  reviews: (a, b) => b.reviews - a.reviews,
  price: (a, b) => (a.priceCents ?? 1e12) - (b.priceCents ?? 1e12) || b.recScore - a.recScore,
  name: (a, b) => a.name.localeCompare(b.name),
};

/**
 * Filter, score and sort the deals.
 *
 * @param {object} p
 * @param {object[]} p.deals     normalized items from the scan
 * @param {object}   p.settings  the person's settings (filters, weights, sort, catalog…)
 * @param {{owned:Set,wishlist:Set,signedIn:boolean}} p.library
 * @param {string}   p.query     search text
 * @param {boolean}  p.personal  For-you mode (taste ranking + a quality floor)
 * @param {object|null} p.model  taste model from logic/taste.js, or null
 * @returns {{list:object[], ownedHidden:number, poolSize:number, personalized:boolean, weights:object}}
 *
 * Each kept item gets score, parts, popularity, match and recScore written onto it, which the cards
 * and the details panel read.
 */
export function rankDeals({ deals, settings: s, library: lib, query = "", personal = false, model = null }) {
  const saleOnly = s.catalog !== "all";
  const hideOwned = (s.hideOwned || personal) && lib.signedIn;
  const tags = s.selectedTags || [];
  // For-you keeps a quality floor so recommendations are credible even with loose filters.
  const minRating = personal ? Math.max(s.minRating, 80) : s.minRating;
  const minReviews = personal ? Math.max(s.minReviews, 300) : s.minReviews;

  const base = deals.filter((d) => (!saleOnly || d.discount >= s.minDiscount) && (d.rating ?? -1) >= minRating && d.reviews >= minReviews);
  const ownedInBase = lib.signedIn ? base.filter((d) => lib.owned.has(d.appid)).length : 0;
  let pool = hideOwned ? base.filter((d) => !lib.owned.has(d.appid)) : base;
  if (s.wishlistOnly && lib.signedIn) pool = pool.filter((d) => lib.wishlist.has(d.appid));
  if (tags.length) pool = pool.filter((d) => tags.every((t) => d.tagids.includes(t)));
  if (s.deckMachineOnly) pool = pool.filter(playsOnDeckOrMachine);

  // Score: discount / rating / popularity. In All-games mode discount drops out so the
  // ranking is "best games", not "best bargains".
  const maxReviews = pool.reduce((m, d) => Math.max(m, d.reviews), 1);
  const logMax = Math.log10(maxReviews) || 1;
  const w = saleOnly ? normWeights(s.weights) : normWeights({ discount: 0, rating: s.weights?.rating ?? 35, popularity: s.weights?.popularity ?? 25 });
  for (const d of pool) {
    d.popularity = d.reviews > 0 ? (100 * Math.log10(d.reviews)) / logMax : 0;
    d.parts = { discount: w.discount * d.discount, rating: w.rating * (d.rating ?? 0), popularity: w.popularity * d.popularity };
    d.score = d.parts.discount + d.parts.rating + d.parts.popularity;
  }

  // Taste match: z-scored tag lift squashed to 0–100, then blended with the deal score.
  const useModel = personal && model && pool.length;
  if (useModel) {
    const raws = pool.map((d) => model.raw(d));
    const mean = raws.reduce((a, b) => a + b, 0) / raws.length;
    const sd = Math.sqrt(raws.reduce((a, r) => a + (r - mean) ** 2, 0) / raws.length) || 1;
    const p = Math.max(0, Math.min(100, Number(s.personalWeight ?? 60))) / 100;
    pool.forEach((d, i) => {
      d.match = 100 / (1 + Math.exp(-1.4 * ((raws[i] - mean) / sd)));
      d.recScore = p * d.match + (1 - p) * d.score;
    });
  } else {
    for (const d of pool) {
      d.match = null;
      d.recScore = d.score;
    }
  }

  const q = query.trim().toLowerCase();
  const list = q ? pool.filter((d) => d.name.toLowerCase().includes(q)) : pool.slice();
  const sortKey = s.sort === "match" && !useModel ? "score" : s.sort;
  list.sort(SORTERS[sortKey] || SORTERS.score);
  return { list, ownedHidden: hideOwned ? ownedInBase : 0, poolSize: pool.length, personalized: Boolean(useModel), weights: w };
}
