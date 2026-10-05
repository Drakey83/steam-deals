// "Not interested": the dismissed list, filtering, and the negative taste signal.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_DISMISSED, addDismissed, dismissEntry, dismissedIds, negativeProfile, removeDismissed } from "../src/renderer/logic/dismiss.js";
import { rankDeals } from "../src/renderer/logic/ranking.js";
import { buildTasteModel } from "../src/renderer/logic/taste.js";

// Tag ids used below.
const ROGUELIKE = 1;
const ACTION = 2;
const SINGLEPLAYER = 3;
const PUZZLE = 4;
const tags = (pairs) => pairs.map(([id, w]) => ({ id, w }));
const game = (appid, tagPairs, o = {}) => ({
  appid, name: `Game ${appid}`, discount: 75, rating: 90, reviews: 1000, priceCents: 500, tagids: tagPairs.map(([id]) => id), tags: tags(tagPairs), ...o,
});
const settings = { catalog: "sale", minDiscount: 50, minRating: 80, minReviews: 0, hideOwned: true, selectedTags: [], weights: { discount: 40, rating: 35, popularity: 25 }, sort: "match", personalWeight: 100 };
const lib = { owned: new Set(), wishlist: new Set(), signedIn: true };

// A catalog where roguelikes are a minority, so the tag is distinctive; the person likes action and roguelikes.
const roguelikeA = game(10, [[ROGUELIKE, 0.5], [ACTION, 0.3], [SINGLEPLAYER, 0.2]]);
const roguelikeB = game(11, [[ROGUELIKE, 0.5], [ACTION, 0.3], [SINGLEPLAYER, 0.2]]);
const roguelikeC = game(12, [[ROGUELIKE, 0.45], [ACTION, 0.35], [SINGLEPLAYER, 0.2]]);
const puzzle = game(20, [[PUZZLE, 0.6], [SINGLEPLAYER, 0.4]]);
const action = game(21, [[ACTION, 0.6], [SINGLEPLAYER, 0.4]]);
const filler = Array.from({ length: 20 }, (_, i) => game(100 + i, [[SINGLEPLAYER, 0.5], [PUZZLE, 0.25], [ACTION, 0.25]]));
const deals = [roguelikeA, roguelikeB, roguelikeC, puzzle, action, ...filler];
const taste = { affinity: { [ROGUELIKE]: 0.4, [ACTION]: 0.4, [SINGLEPLAYER]: 0.2 }, anchors: [] };
const rank = (dismissed) => {
  const model = buildTasteModel(taste, deals, dismissed);
  return rankDeals({ deals, settings, library: lib, personal: true, model, dismissed: dismissedIds(dismissed) }).list.map((d) => d.appid);
};

test("dismissing two roguelikes down-ranks another roguelike; restoring reverts it", () => {
  const before = rank([]);
  assert.ok(before.indexOf(12) < before.indexOf(21), "a roguelike starts above the plain action game");

  const dismissed = addDismissed(addDismissed([], roguelikeA), roguelikeB);
  const after = rank(dismissed);
  assert.ok(!after.includes(10) && !after.includes(11), "dismissed games are hidden");
  assert.ok(after.indexOf(12) > after.indexOf(21), "the other roguelike now ranks below the action game");

  const restored = removeDismissed(removeDismissed(dismissed, 10), 11);
  assert.deepEqual(rank(restored), before);
});

test("tags as common in dismissed games as in the catalog are left alone", () => {
  const dismissed = [dismissEntry(roguelikeA), dismissEntry(roguelikeB)];
  const plain = buildTasteModel(taste, deals, []);
  const withDismissals = buildTasteModel(taste, deals, dismissed);
  assert.ok(withDismissals.lift.get(ROGUELIKE) < plain.lift.get(ROGUELIKE) - 1, "the distinctive tag is pushed down hard");
  assert.equal(withDismissals.lift.get(SINGLEPLAYER), plain.lift.get(SINGLEPLAYER), "a tag that's everywhere is untouched");
});

test("one dismissal counts for less than two (confidence grows with evidence)", () => {
  const one = buildTasteModel(taste, deals, [dismissEntry(roguelikeA)]).lift.get(ROGUELIKE);
  const two = buildTasteModel(taste, deals, [dismissEntry(roguelikeA), dismissEntry(roguelikeB)]).lift.get(ROGUELIKE);
  assert.ok(two < one);
});

test("the list keeps the newest first, has no duplicates, and is capped", () => {
  let list = addDismissed([], roguelikeA, 1);
  list = addDismissed(list, puzzle, 2);
  list = addDismissed(list, roguelikeA, 3);
  assert.deepEqual(list.map((x) => x.appid), [10, 20]);
  for (let i = 0; i < MAX_DISMISSED + 20; i++) list = addDismissed(list, game(1000 + i, [[PUZZLE, 1]]));
  assert.equal(list.length, MAX_DISMISSED);
});

test("entries keep the strongest tags so they still count after the game leaves the deals", () => {
  const e = dismissEntry(game(5, [[1, 0.1], [2, 0.6], [3, 0.3]]));
  assert.deepEqual(e.tags.map((t) => t.id), [2, 3, 1]);
  const neg = negativeProfile([e, dismissEntry(game(6, [[2, 0.4]]))]);
  assert.equal(neg.get(2).weight, 0.5);
  assert.equal(neg.get(2).share, 1);
  assert.equal(neg.get(3).share, 0.5);
});

test("a theme the dismissed games share counts for more than a tag only one of them had", () => {
  const SHOOTER = 5;
  const catalog = [...deals, game(30, [[SHOOTER, 0.5], [ACTION, 0.5]]), game(31, [[SHOOTER, 0.5], [ACTION, 0.5]])];
  const shooterRoguelike = game(40, [[ROGUELIKE, 0.4], [SHOOTER, 0.4], [ACTION, 0.2]]);
  const plainRoguelike = game(41, [[ROGUELIKE, 0.5], [PUZZLE, 0.5]]);
  const liked = { affinity: { [ROGUELIKE]: 0.3, [SHOOTER]: 0.4, [ACTION]: 0.3 }, anchors: [] };
  const plain = buildTasteModel(liked, catalog, []);
  const m = buildTasteModel(liked, catalog, [dismissEntry(shooterRoguelike), dismissEntry(plainRoguelike)]);
  const drop = (id) => plain.lift.get(id) - m.lift.get(id);
  assert.ok(drop(ROGUELIKE) > drop(SHOOTER), "roguelike (in both) drops more than shooter (in one)");
});

test("dismissals still count for a tag the library already dislikes (no clamp swallowing them)", () => {
  const dislikes = { affinity: { [ACTION]: 0.9, [SINGLEPLAYER]: 0.1 }, anchors: [] }; // no roguelikes at all
  const plain = buildTasteModel(dislikes, deals, []).lift.get(ROGUELIKE);
  const after = buildTasteModel(dislikes, deals, [dismissEntry(roguelikeA), dismissEntry(roguelikeB)]).lift.get(ROGUELIKE);
  assert.equal(plain, -2.5);
  assert.ok(after < plain - 1);
});

test("works without a taste profile: Browse just hides dismissed games", () => {
  const r = rankDeals({ deals, settings: { ...settings, sort: "score" }, library: lib, dismissed: new Set([20]) });
  assert.ok(!r.list.some((d) => d.appid === 20));
});
