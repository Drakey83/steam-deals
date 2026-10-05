// The UI's pure logic: ranking, the taste model, basket maths, formatting.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { basketItem, basketTotals, mergeIncoming, toggleInList } from "../src/renderer/logic/basket.js";
import { normWeights, playsOnDeckOrMachine, rankDeals } from "../src/renderer/logic/ranking.js";
import { buildTasteModel } from "../src/renderer/logic/taste.js";
import { durationText, fmtCents, plural, timeAgo } from "../src/renderer/lib/format.js";

const require = createRequire(import.meta.url);
const core = require("../src/shared/core.js");

const deal = (appid, o = {}) => ({
  appid, name: o.name || `Game ${appid}`, discount: 75, rating: 90, reviews: 1000, priceCents: 500, price: "$5.00",
  tagids: [], tags: [], deck: 0, machine: 0, ...o,
});
const settings = (o = {}) => ({
  catalog: "sale", minDiscount: 50, minRating: 80, minReviews: 0, hideOwned: true, wishlistOnly: false,
  selectedTags: [], deckMachineOnly: false, weights: { discount: 40, rating: 35, popularity: 25 }, sort: "score", personalWeight: 60, ...o,
});
const lib = (o = {}) => ({ owned: new Set(), wishlist: new Set(), signedIn: false, ...o });

// ----- ranking -----
test("normWeights turns the three weights into fractions summing to 1", () => {
  const w = normWeights({ discount: 40, rating: 35, popularity: 25 });
  assert.equal(Math.round((w.discount + w.rating + w.popularity) * 1000), 1000);
  assert.equal(w.discount, 0.4);
  assert.deepEqual(normWeights({ discount: 0, rating: 0, popularity: 0 }), { discount: 0, rating: 0, popularity: 0 });
});

test("filters by discount, rating and review count", () => {
  const deals = [deal(1), deal(2, { discount: 40 }), deal(3, { rating: 70 }), deal(4, { reviews: 5 })];
  const r = rankDeals({ deals, settings: settings({ minReviews: 100 }), library: lib() });
  assert.deepEqual(r.list.map((d) => d.appid), [1]);
});

test("hides owned games when signed in and counts them", () => {
  const r = rankDeals({ deals: [deal(1), deal(2)], settings: settings(), library: lib({ signedIn: true, owned: new Set([2]) }) });
  assert.deepEqual(r.list.map((d) => d.appid), [1]);
  assert.equal(r.ownedHidden, 1);
});

test("the Steam Deck / Machine switch keeps Verified or Playable on either device", () => {
  const deals = [deal(1, { deck: 3 }), deal(2, { machine: 2 }), deal(3, { deck: 1, machine: 1 }), deal(4)];
  assert.deepEqual(deals.filter(playsOnDeckOrMachine).map((d) => d.appid), [1, 2]);
  const r = rankDeals({ deals, settings: settings({ deckMachineOnly: true }), library: lib() });
  assert.deepEqual(r.list.map((d) => d.appid).sort(), [1, 2]);
  const off = rankDeals({ deals, settings: settings({ deckMachineOnly: false }), library: lib() });
  assert.equal(off.list.length, 4);
});

test("all selected tags must match", () => {
  const deals = [deal(1, { tagids: [5, 6] }), deal(2, { tagids: [5] })];
  const r = rankDeals({ deals, settings: settings({ selectedTags: [5, 6] }), library: lib() });
  assert.deepEqual(r.list.map((d) => d.appid), [1]);
});

test("search matches names case-insensitively", () => {
  const r = rankDeals({ deals: [deal(1, { name: "Portal 2" }), deal(2, { name: "Doom" })], settings: settings(), library: lib(), query: " portal " });
  assert.deepEqual(r.list.map((d) => d.appid), [1]);
});

test("score blends discount, rating and popularity; bigger discount ranks higher, all else equal", () => {
  const r = rankDeals({ deals: [deal(1, { discount: 60 }), deal(2, { discount: 90 })], settings: settings(), library: lib() });
  assert.deepEqual(r.list.map((d) => d.appid), [2, 1]);
  const top = r.list[0];
  assert.ok(Math.abs(top.score - (top.parts.discount + top.parts.rating + top.parts.popularity)) < 1e-9);
});

test("All-games mode ignores the discount in the score", () => {
  const r = rankDeals({ deals: [deal(1, { discount: 0, rating: 95 }), deal(2, { discount: 90, rating: 85 })], settings: settings({ catalog: "all" }), library: lib() });
  assert.equal(r.weights.discount, 0);
  assert.deepEqual(r.list.map((d) => d.appid), [1, 2]);
});

test("For-you keeps a quality floor even with loose filters", () => {
  const r = rankDeals({ deals: [deal(1, { rating: 60 }), deal(2, { reviews: 50 }), deal(3)], settings: settings({ minRating: 50 }), library: lib(), personal: true });
  assert.deepEqual(r.list.map((d) => d.appid), [3]);
});

test("price sort puts the cheapest first", () => {
  const r = rankDeals({ deals: [deal(1, { priceCents: 999 }), deal(2, { priceCents: 199 })], settings: settings({ sort: "price" }), library: lib() });
  assert.deepEqual(r.list.map((d) => d.appid), [2, 1]);
});

// ----- taste model -----
const tags = (pairs) => pairs.map(([id, w]) => ({ id, w }));
test("the taste model ranks games with the person's distinctive tags higher", () => {
  const deals = [deal(1, { tags: tags([[10, 1]]) }), deal(2, { tags: tags([[20, 1]]) }), deal(3, { tags: tags([[20, 1]]) })];
  const model = buildTasteModel({ affinity: { 10: 0.8, 20: 0.2 }, anchors: [] }, deals);
  assert.ok(model.raw(deals[0]) > model.raw(deals[1]));
  assert.deepEqual(model.topTags[0], 10);
  const r = rankDeals({ deals, settings: settings({ sort: "match" }), library: lib(), personal: true, model });
  assert.equal(r.personalized, true);
  assert.equal(r.list[0].appid, 1);
  assert.ok(r.list.every((d) => d.match >= 0 && d.match <= 100));
});

test("similar() names the owned games a deal resembles", () => {
  const deals = [deal(1, { tags: tags([[10, 0.7], [11, 0.3]]) })];
  const model = buildTasteModel({ affinity: { 10: 1 }, anchors: [{ appid: 99, name: "Owned Game", hours: 50, tags: tags([[10, 0.8], [11, 0.2]]) }] }, deals);
  assert.deepEqual(model.similar(deals[0]).map((x) => x.name), ["Owned Game"]);
});

test("no profile means no model", () => {
  assert.equal(buildTasteModel(null, []), null);
});

// ----- basket -----
test("toggleInList adds then removes a game", () => {
  const d = deal(1, { packageid: 7 });
  const a = toggleInList([], d);
  assert.equal(a.added, true);
  assert.deepEqual(a.list, [basketItem(d)]);
  const b = toggleInList(a.list, d);
  assert.equal(b.added, false);
  assert.deepEqual(b.list, []);
});

test("mergeIncoming skips duplicates and unknown games", () => {
  const lookup = new Map([[1, deal(1)], [2, deal(2, { packageid: 22 })]]);
  const { list, added } = mergeIncoming([basketItem(deal(1))], [{ appid: 1 }, { appid: 2, packageid: null }, { appid: 3 }], lookup);
  assert.equal(added, 1);
  assert.deepEqual(list.map((b) => [b.appid, b.packageid]), [[1, null], [2, 22]]);
});

test("basket totals: subtotal, savings and US state tax", () => {
  const items = [basketItem(deal(1, { priceCents: 499, originalCents: 1999 })), basketItem(deal(2, { priceCents: 101, originalCents: 101 }))];
  const t = basketTotals(items, { taxRegion: "US-TX", country: "US" }, core);
  assert.equal(t.subtotal, 600);
  assert.equal(t.savings, 1500);
  assert.equal(t.rate, 6.25);
  assert.equal(t.taxCents, Math.round(600 * 0.0625));
  assert.equal(t.total, 600 + t.taxCents);
});

test("prices that include tax add nothing", () => {
  const t = basketTotals([basketItem(deal(1, { priceCents: 1000 }))], { taxRegion: "included", country: "DE" }, core);
  assert.equal(t.taxCents, 0);
  assert.equal(t.total, 1000);
});

// ----- formatting -----
test("fmtCents reuses the currency format of a real price", () => {
  assert.equal(fmtCents(1234, "$9.99"), "$12.34");
  assert.match(fmtCents(1234, "9,99€"), /€$/);
});

test("timeAgo and durationText", () => {
  const now = 1_000_000_000_000;
  assert.equal(timeAgo(now - 30_000, now), "just now");
  assert.equal(timeAgo(now - 5 * 60_000, now), "5 min ago");
  assert.equal(durationText(3 * 3600_000), "3 hours");
  assert.equal(plural(1, "game"), "1 game");
  assert.equal(plural(3, "game"), "3 games");
});
