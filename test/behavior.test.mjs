// Learning from behaviour: up-weighting, time decay, library dominance, reset, and the bounded event log.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_WEIGHTS, HALF_LIFE_DAYS, MAX_BEHAVIOR_SHARE, MAX_EVENTS,
  behaviorShare, behaviorSignal, blendAffinity, decay, newlyOwned, recordEvent, withBehavior,
} from "../src/renderer/logic/behavior.js";
import { rankDeals } from "../src/renderer/logic/ranking.js";
import { buildTasteModel } from "../src/renderer/logic/taste.js";

const DAY = 86400000;
const NOW = 1_800_000_000_000;
const PUZZLE = 1;
const SHOOTER = 2;
const SINGLEPLAYER = 3;
const tags = (pairs) => pairs.map(([id, w]) => ({ id, w }));
const game = (appid, pairs) => ({ appid, name: `Game ${appid}`, discount: 75, rating: 90, reviews: 1000, priceCents: 500, tagids: pairs.map(([id]) => id), tags: tags(pairs) });
const puzzleGame = (appid) => game(appid, [[PUZZLE, 0.6], [SINGLEPLAYER, 0.4]]);
const shooterGame = (appid) => game(appid, [[SHOOTER, 0.6], [SINGLEPLAYER, 0.4]]);
const library = { affinity: { [SHOOTER]: 0.7, [PUZZLE]: 0.1, [SINGLEPLAYER]: 0.2 }, anchors: [] };
const deals = [puzzleGame(1), shooterGame(2), puzzleGame(3), shooterGame(4), ...Array.from({ length: 10 }, (_, i) => game(100 + i, [[SINGLEPLAYER, 1]]))];
const settings = { catalog: "sale", minDiscount: 50, minRating: 80, minReviews: 0, hideOwned: true, selectedTags: [], weights: { discount: 40, rating: 35, popularity: 25 }, sort: "match", personalWeight: 100 };
const lib = { owned: new Set(), wishlist: new Set(), signedIn: true };
const rank = (events) => rankDeals({ deals, settings, library: lib, personal: true, model: buildTasteModel(withBehavior(library, events, NOW), deals) }).list;
const matchOf = (events, appid) => rank(events).find((d) => d.appid === appid).match;

/** Several basket adds of puzzle games, spread over today. */
const puzzleInterest = (at = NOW) => [5, 6, 7, 8, 9].reduce((ev, id) => recordEvent(ev, "basket", puzzleGame(id), at), []);

test("up-weighting: basket adds of puzzle games raise puzzle affinity and puzzle matches", () => {
  const events = puzzleInterest();
  assert.ok(blendAffinity(library.affinity, events, NOW)[PUZZLE] > library.affinity[PUZZLE]);
  assert.ok(matchOf(events, 1) > matchOf([], 1), "a puzzle game matches better than before");
  assert.ok(matchOf(events, 2) <= matchOf([], 2), "a shooter doesn't gain from it");
});

test("time decay: an event's weight halves every half-life", () => {
  assert.equal(decay(0), 1);
  assert.ok(Math.abs(decay(HALF_LIFE_DAYS * DAY) - 0.5) < 1e-12);
  assert.ok(Math.abs(decay(2 * HALF_LIFE_DAYS * DAY) - 0.25) < 1e-12);
  const fresh = behaviorSignal(puzzleInterest(NOW), NOW);
  const old = behaviorSignal(puzzleInterest(NOW - 2 * HALF_LIFE_DAYS * DAY), NOW);
  assert.ok(Math.abs(old.evidence - fresh.evidence / 4) < 1e-9);
  const freshGain = blendAffinity(library.affinity, puzzleInterest(NOW), NOW)[PUZZLE];
  const oldGain = blendAffinity(library.affinity, puzzleInterest(NOW - 120 * DAY), NOW)[PUZZLE];
  assert.ok(oldGain < freshGain, "old behaviour moves the profile less");
});

test("library dominance: no behaviour means exactly the library profile", () => {
  assert.equal(blendAffinity(library.affinity, [], NOW), library.affinity);
  assert.equal(withBehavior(library, [], NOW), library);
  assert.deepEqual(rank([]).map((d) => d.appid), rankDeals({ deals, settings, library: lib, personal: true, model: buildTasteModel(library, deals) }).list.map((d) => d.appid));
});

test("library dominance: even overwhelming behaviour never takes more than the maximum share", () => {
  let events = [];
  for (let i = 0; i < MAX_EVENTS; i++) events = recordEvent(events, "basket", puzzleGame(1000 + i), NOW);
  const { evidence } = behaviorSignal(events, NOW);
  assert.ok(behaviorShare(evidence) <= MAX_BEHAVIOR_SHARE);
  const blended = blendAffinity(library.affinity, events, NOW);
  assert.ok(blended[SHOOTER] >= (1 - MAX_BEHAVIOR_SHARE) * library.affinity[SHOOTER] - 1e-12, "the library's main tag keeps its share");
  assert.ok(blended[SHOOTER] > blended[PUZZLE], "and still leads");
});

test("dismissals in the log count against their tags (never below zero)", () => {
  let events = [];
  for (const id of [11, 12, 13]) events = recordEvent(events, "dismissed", shooterGame(id), NOW);
  const blended = blendAffinity(library.affinity, events, NOW);
  assert.ok(blended[SHOOTER] < library.affinity[SHOOTER]);
  assert.ok(Object.values(blended).every((v) => v >= 0));
  assert.ok(EVENT_WEIGHTS.dismissed < 0);
});

test("full reset: clearing the log returns rankings to the library alone", () => {
  // (A few puzzle adds lift puzzle matches without overturning a strongly shooter library, so compare scores.)
  const scores = (list) => list.map((d) => [d.appid, d.match.toFixed(6)]);
  const learned = scores(rank(puzzleInterest()));
  const reset = scores(rank([]));
  const libraryOnly = scores(rankDeals({ deals, settings, library: lib, personal: true, model: buildTasteModel(library, deals) }).list);
  assert.notDeepEqual(learned, libraryOnly, "behaviour changed the scores");
  assert.deepEqual(reset, libraryOnly, "and reset undid it completely");
});

test("the log is bounded, newest first, and ignores quick repeats", () => {
  let events = recordEvent([], "opened", puzzleGame(1), NOW);
  events = recordEvent(events, "opened", puzzleGame(1), NOW + 60_000); // a minute later: same visit
  assert.equal(events.length, 1);
  events = recordEvent(events, "opened", puzzleGame(1), NOW + 2 * 3600_000); // hours later: counts again
  assert.equal(events.length, 2);
  for (let i = 0; i < MAX_EVENTS + 50; i++) events = recordEvent(events, "opened", puzzleGame(5000 + i), NOW + i);
  assert.equal(events.length, MAX_EVENTS);
  assert.equal(events[0].appid, 5000 + MAX_EVENTS + 49);
  assert.deepEqual(recordEvent(events, "bogus", puzzleGame(1), NOW), events);
});

test("games opened or basketed here and now owned become one 'owned' event each", () => {
  let events = recordEvent([], "opened", puzzleGame(1), NOW);
  events = recordEvent(events, "basket", puzzleGame(1), NOW);
  events = recordEvent(events, "opened", shooterGame(2), NOW);
  const after = newlyOwned(events, new Set([1, 99]), NOW + DAY);
  assert.deepEqual(after.filter((e) => e.type === "owned").map((e) => e.appid), [1]);
  assert.equal(newlyOwned(after, new Set([1, 99]), NOW + 2 * DAY), after, "owned counts once ever");
});
