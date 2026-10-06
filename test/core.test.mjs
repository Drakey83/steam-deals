// Shared core (used by the desktop app, the website, and the Vercel functions) and the deep-link parser.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const core = require("../src/shared/core.js");
const { parseDeepLink } = require("../src/main/deeplink.js");

const storeItem = (o = {}) => ({
  appid: 10, item_type: 0, type: 0, name: "Game", visible: true,
  best_purchase_option: { packageid: 77, discount_pct: 80, final_price_in_cents: 199, original_price_in_cents: 999, formatted_final_price: "$1.99", formatted_original_price: "$9.99" },
  reviews: { summary_filtered: { percent_positive: 93, review_count: 1200, review_score_label: "Very Positive" } },
  tags: [{ tagid: 1, weight: 3 }, { tagid: 2, weight: 1 }],
  platforms: { steam_deck_compat_category: 3, steam_machine_compat_category: 2 },
  ...o,
});

test("normalizeItem keeps what the UI needs, including Deck / Machine ratings", () => {
  const n = core.normalizeItem(storeItem());
  assert.equal(n.packageid, 77);
  assert.equal(n.discount, 80);
  assert.equal(n.priceCents, 199);
  assert.equal(n.rating, 93);
  assert.equal(n.deck, 3);
  assert.equal(n.machine, 2);
  assert.equal(Math.round(n.tags.reduce((s, t) => s + t.w, 0) * 1000), 1000); // tag weights normalized
});

test("normalizeItem drops DLC, free games, and (in sale mode) undiscounted games", () => {
  assert.equal(core.normalizeItem(storeItem({ type: 1 })), null);
  assert.equal(core.normalizeItem(storeItem({ is_free: true })), null);
  const full = storeItem({ best_purchase_option: { ...storeItem().best_purchase_option, discount_pct: 0 } });
  assert.equal(core.normalizeItem(full), null);
  assert.notEqual(core.normalizeItem(full, { requireDiscount: false }), null);
});

test("missing or odd compatibility values become 0 (not rated)", () => {
  assert.equal(core.normalizeItem(storeItem({ platforms: {} })).deck, 0);
  assert.equal(core.normalizeItem(storeItem({ platforms: { steam_deck_compat_category: 9 } })).deck, 0);
});

test("the deals query asks Steam for the compatibility ratings", () => {
  assert.equal(core.buildQueryInput({}).data_request.include_platforms, true);
});

test("basketOps describes the change between two baskets; sameBasket ignores names and prices", () => {
  const a = [{ appid: 1, packageid: 11 }, { appid: 2, packageid: 22 }];
  const b = [{ appid: 2, packageid: 22 }, { appid: 3, packageid: 33 }];
  assert.deepEqual(core.basketOps(a, b), [{ op: "remove", appid: 1 }, { op: "add", item: { appid: 3, packageid: 33 } }]);
  assert.deepEqual(core.basketOps(a, a), []);
  assert.equal(core.sameBasket([{ appid: 1, packageid: 11, name: "x" }], [{ appid: 1, packageid: 11, name: "y" }]), true);
});

test("tax regions: estimate, defaults, included, custom", () => {
  assert.equal(core.estimateTax(1000, "US-TX").taxCents, 63);
  assert.equal(core.estimateTax(1000, "included").taxCents, 0);
  assert.equal(core.estimateTax(1000, "custom", 10).taxCents, 100);
  assert.equal(core.defaultTaxRegion("DE"), "included");
});

test("isSteamId64 accepts 17-digit ids starting 7656119 only", () => {
  assert.equal(core.isSteamId64("76561197971128222"), true);
  assert.equal(core.isSteamId64("7656119797112822"), false);
  assert.equal(core.isSteamId64("12345678901234567"), false);
});

test("deep links from the website parse into basket items, junk is ignored", () => {
  assert.deepEqual(parseDeepLink("steamdeals://cart?items=10:7,20:0,abc,30&v=1"), { items: [{ appid: 10, packageid: 7 }, { appid: 20, packageid: null }, { appid: 30, packageid: null }] });
  assert.equal(parseDeepLink("steamdeals://other?items=1:2"), null);
  assert.equal(parseDeepLink("https://evil.example/cart?items=1:2"), null);
  assert.equal(parseDeepLink("not a url"), null);
});

test("a save can't remove basket games the screen never showed (they arrived while it was out of date)", () => {
  const a = { appid: 1 }, b = { appid: 2 }, c = { appid: 3 }, d = { appid: 4 };
  // The shared basket has a, b, c, d; this screen only ever showed an empty basket, then added d.
  assert.deepEqual(core.keepUnseen([a, b, c, d], [d], []).map((i) => i.appid), [4, 1, 2, 3]);
  // A screen that showed a and b, and removed b on purpose, removes b; c and d (unseen) stay.
  assert.deepEqual(core.keepUnseen([a, b, c, d], [a], [a, b]).map((i) => i.appid).sort(), [1, 3, 4]);
  // Removing everything it saw works; clearing a basket it saw fully empties it.
  assert.deepEqual(core.keepUnseen([a, b], [], [a, b]), []);
  // Unknown history: unchanged.
  const next = [a];
  assert.equal(core.keepUnseen([a, b], next, null), next);
});
