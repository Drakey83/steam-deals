// Putting tags in and taking them out of "Your taste" by hand (logic/taste.js).
import assert from "node:assert/strict";
import { test } from "node:test";
import { rankDeals } from "../src/renderer/logic/ranking.js";
import { addTasteTag, buildTasteModel, MAX_TASTE_EDITS, normalizeTasteEdits, removeTasteTag, restoreTasteTag } from "../src/renderer/logic/taste.js";

const ROGUELIKE = 1;
const ACTION = 2;
const SINGLEPLAYER = 3;
const PUZZLE = 4;
const tags = (pairs) => pairs.map(([id, w]) => ({ id, w }));
const game = (appid, tagPairs) => ({ appid, name: `Game ${appid}`, discount: 75, rating: 90, reviews: 1000, priceCents: 500, tagids: tagPairs.map(([id]) => id), tags: tags(tagPairs) });
const settings = { catalog: "sale", minDiscount: 50, minRating: 80, minReviews: 0, hideOwned: true, selectedTags: [], weights: { discount: 40, rating: 35, popularity: 25 }, sort: "match", personalWeight: 100 };
const lib = { owned: new Set(), wishlist: new Set(), signedIn: true };

const roguelike = game(10, [[ROGUELIKE, 0.5], [ACTION, 0.3], [SINGLEPLAYER, 0.2]]);
const puzzle = game(20, [[PUZZLE, 0.6], [SINGLEPLAYER, 0.4]]);
const action = game(21, [[ACTION, 0.6], [SINGLEPLAYER, 0.4]]);
const filler = Array.from({ length: 20 }, (_, i) => game(100 + i, [[SINGLEPLAYER, 0.5], [PUZZLE, 0.25], [ACTION, 0.25]]));
const deals = [roguelike, puzzle, action, ...filler];
const taste = { affinity: { [ROGUELIKE]: 0.4, [ACTION]: 0.4, [SINGLEPLAYER]: 0.2 }, anchors: [] };
const order = (edits) => rankDeals({ deals, settings, library: lib, personal: true, model: buildTasteModel(taste, deals, [], edits) }).list.map((d) => d.appid);

test("no edits: the model is exactly the library's", () => {
  const plain = buildTasteModel(taste, deals);
  const empty = buildTasteModel(taste, deals, [], { added: [], removed: [] });
  assert.deepEqual(empty.topTags, plain.topTags);
  assert.deepEqual(empty.learnedTags, plain.topTags);
  assert.deepEqual(order({}), rankDeals({ deals, settings, library: lib, personal: true, model: plain }).list.map((d) => d.appid));
});

test("adding a tag puts it in Your taste and pushes its games up", () => {
  const before = order({});
  assert.ok(before.indexOf(20) > before.indexOf(21), "the puzzle game starts below the action game");
  const model = buildTasteModel(taste, deals, [], { added: [PUZZLE] });
  assert.equal(model.topTags[0], PUZZLE, "added tags come first");
  assert.ok(model.added.has(PUZZLE));
  assert.ok(!model.learnedTags.includes(PUZZLE), "it wasn't learned");
  const after = order({ added: [PUZZLE] });
  assert.ok(after.indexOf(20) < after.indexOf(21), "now the puzzle game ranks above the action game");
});

test("removing a learned tag takes it out of Your taste and stops it pushing games up, without penalising them", () => {
  const model = buildTasteModel(taste, deals, [], { removed: [ROGUELIKE] });
  assert.ok(!model.topTags.includes(ROGUELIKE));
  assert.ok(model.learnedTags.includes(ROGUELIKE), "still known as learned, so it can be restored");
  assert.equal(model.lift.get(ROGUELIKE), 0, "neutral, not disliked");
  // The roguelike game is also an action game, so it can stay first; its lead over the plain action game shrinks.
  const plain = buildTasteModel(taste, deals);
  const gap = (m) => m.raw(roguelike) - m.raw(action);
  assert.ok(gap(model) < gap(plain), "the roguelike game loses the boost its roguelike tag gave it");});

test("edit helpers: add, remove (learned or not), restore, and odd input", () => {
  let e = addTasteTag(null, PUZZLE);
  assert.deepEqual(e, { added: [PUZZLE], removed: [] });
  assert.deepEqual(addTasteTag(e, PUZZLE), e, "adding twice changes nothing");
  assert.deepEqual(removeTasteTag(e, PUZZLE, false), { added: [], removed: [] }, "an added tag just goes away");
  e = removeTasteTag(e, ROGUELIKE, true);
  assert.deepEqual(e, { added: [PUZZLE], removed: [ROGUELIKE] }, "a learned tag is remembered as removed");
  assert.deepEqual(addTasteTag(e, ROGUELIKE), { added: [PUZZLE, ROGUELIKE], removed: [] }, "adding it back clears the removal");
  assert.deepEqual(restoreTasteTag(e, ROGUELIKE), { added: [PUZZLE], removed: [] });
  assert.deepEqual(normalizeTasteEdits({ added: [1, "2", -3, "x", 1], removed: "nope" }), { added: [1, 2], removed: [] });
  const many = Array.from({ length: MAX_TASTE_EDITS + 5 }, (_, i) => i + 1).reduce((acc, id) => addTasteTag(acc, id), null);
  assert.equal(many.added.length, MAX_TASTE_EDITS, "capped");
});
