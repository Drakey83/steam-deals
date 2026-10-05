// Price history: shaping IsThereAnyDeal data on the server, and the badge / 90-day maths in the UI.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { historyBadge, lowestEver, summarizeWindow, WINDOW_DAYS } from "../src/renderer/logic/history.js";

const require = createRequire(import.meta.url);
const itad = require("../web/api/_lib/itad.js");

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 5);
const price = (cents, currency = "USD") => ({ amount: cents / 100, amountInt: cents, currency });

// ----- the badge only ever appears with real data behind it -----
test("no history, no badge", () => {
  for (const entry of [undefined, null, {}, { low: null }, { low: { cents: null } }]) assert.equal(historyBadge(entry, 199), null);
});

test("no current price, no badge", () => {
  assert.equal(historyBadge({ low: { cents: 199 } }, null), null);
  assert.equal(historyBadge({ low: { cents: 199 } }, 0), null);
});

test("lowest ever: below the record is new, equal matches, above is nothing", () => {
  const entry = { low: { cents: 299, at: NOW - 100 * DAY } };
  assert.equal(lowestEver(entry, 199).kind, "new");
  assert.equal(lowestEver(entry, 299).kind, "matches");
  assert.equal(lowestEver(entry, 399), null);
  assert.equal(historyBadge(entry, 299), "lowest-ever");
  assert.equal(historyBadge(entry, 399), null);
});

// ----- the 90-day window -----
const pt = (daysAgo, cents, cut) => ({ at: NOW - daysAgo * DAY, cents, regularCents: 1999, cut });

test("no points in or before the window means no summary", () => {
  assert.equal(summarizeWindow([], NOW), null);
  assert.equal(summarizeWindow(undefined, NOW), null);
});

test("90-day low counts the price in force when the window opened", () => {
  const s = summarizeWindow([pt(200, 499, 75), pt(60, 1999, 0)], NOW);
  assert.equal(s.lowCents, 499, "the 75%-off price ran until 60 days ago, inside the window");
  assert.equal(s.coveredDays, WINDOW_DAYS);
});

test("typical sale is the time-weighted median discount while on sale", () => {
  // 30 days at full price, 50 days at -50%, 10 days at -80%.
  const s = summarizeWindow([pt(90, 1999, 0), pt(60, 999, 50), pt(10, 399, 80)], NOW);
  assert.equal(s.typicalCut, 50);
  assert.equal(s.lowCents, 399);
  assert.ok(Math.abs(s.saleShare - 60 / 90) < 1e-9);
});

test("never on sale in the window: no typical sale", () => {
  const s = summarizeWindow([pt(120, 1999, 0)], NOW);
  assert.equal(s.typicalCut, null);
  assert.equal(s.saleShare, 0);
});

// ----- server-side shaping of IsThereAnyDeal responses -----
test("shop-id lookup maps Steam appids to ITAD ids and skips unknown games", () => {
  const ids = itad.idsFromLookup({ "app/10": "uuid-10", "app/20": null, "sub/5": "uuid-sub" });
  assert.deepEqual([...ids], [[10, "uuid-10"]]);
});

test("store low picks the Steam shop's record", () => {
  const entry = { id: "uuid-10", lows: [
    { shop: { id: 35, name: "GOG" }, price: price(99), regular: price(999), cut: 90, timestamp: "2024-01-01T00:00:00Z" },
    { shop: { id: itad.STEAM_SHOP, name: "Steam" }, price: price(199), regular: price(999), cut: 80, timestamp: "2025-06-01T00:00:00Z" },
  ] };
  assert.deepEqual(itad.steamLow(entry), { cents: 199, regularCents: 999, cut: 80, at: Date.parse("2025-06-01T00:00:00Z"), currency: "USD" });
  assert.equal(itad.steamLow({ id: "x", lows: [entry.lows[0]] }), null, "no Steam record means no low");
});

test("history log keeps Steam points only, oldest first", () => {
  const log = [
    { timestamp: "2026-09-01T00:00:00Z", shop: { id: itad.STEAM_SHOP }, deal: { price: price(499), regular: price(1999), cut: 75 } },
    { timestamp: "2026-08-01T00:00:00Z", shop: { id: 35 }, deal: { price: price(299), regular: price(1999), cut: 85 } },
    { timestamp: "2026-07-01T00:00:00Z", shop: { id: itad.STEAM_SHOP }, deal: { price: price(1999), regular: price(1999), cut: 0 } },
  ];
  assert.deepEqual(itad.steamPoints(log).map((p) => [p.cents, p.cut]), [[1999, 0], [499, 75]]);
});

test("dates sent to IsThereAnyDeal have no fractional seconds (it rejects them)", () => {
  assert.equal(itad.isoSeconds(Date.UTC(2026, 6, 7, 1, 2, 3, 456)), "2026-07-07T01:02:03Z");
});
