// Price alerts: exactly one notification per crossing, re-arming, and no surprises.
import assert from "node:assert/strict";
import { test } from "node:test";
import { alertFor, checkAlerts, makeAlert, markSeen, parseMoney, removeAlert, unseenAlerts, upsertAlert } from "../src/renderer/logic/alerts.js";

const game = (priceCents, appid = 10) => ({ appid, name: "Hades", price: `$${(priceCents / 100).toFixed(2)}`, priceCents });
const scan = (alerts, cents, country = "US", appid = 10) => checkAlerts(alerts, new Map([[appid, cents]]), country);

test("triggers once when the price crosses down to the target", () => {
  let alerts = [makeAlert(game(1999), 999, "US")];
  let r = scan(alerts, 1499);
  assert.equal(r.triggered.length, 0);
  r = scan(r.alerts, 999);
  assert.equal(r.triggered.length, 1, "fires at the target");
  assert.equal(r.triggered[0].triggeredCents, 999);
  alerts = r.alerts;
  for (const cents of [999, 899, 999, 950]) {
    r = scan(alerts, cents);
    assert.equal(r.triggered.length, 0, `no repeat while still at or below target (${cents})`);
    alerts = r.alerts;
  }
});

test("no trigger when the price is already below target when the alert is made", () => {
  const alerts = [makeAlert(game(799), 999, "US")];
  assert.equal(alerts[0].armed, false);
  assert.equal(scan(alerts, 799).triggered.length, 0);
  assert.equal(scan(alerts, 699).triggered.length, 0);
});

test("re-arms after the price rises above target, then fires again on the next drop", () => {
  let alerts = scan([makeAlert(game(1999), 999, "US")], 999).alerts; // fired
  let r = scan(alerts, 1999);
  assert.equal(r.triggered.length, 0);
  assert.equal(r.alerts[0].armed, true, "back above target: armed again");
  r = scan(r.alerts, 899);
  assert.equal(r.triggered.length, 1, "fires again on the next crossing");
  alerts = r.alerts;
  // And an alert made while already below arms once the price goes up, then fires on the way down.
  r = scan([makeAlert(game(799), 999, "US")], 1299);
  r = scan(r.alerts, 949);
  assert.equal(r.triggered.length, 1);
});

test("unknown prices and other regions leave alerts untouched", () => {
  const alerts = [makeAlert(game(1999), 999, "US")];
  assert.equal(checkAlerts(alerts, new Map(), "US").alerts, alerts, "same array when nothing changed");
  assert.equal(scan(alerts, 499, "GB").triggered.length, 0, "a GB price is in another currency");
  assert.equal(scan(alerts, NaN).triggered.length, 0);
});

test("fired alerts are unseen until the panel is opened", () => {
  const fired = scan([makeAlert(game(1999), 999, "US")], 899).alerts;
  assert.equal(unseenAlerts(fired).length, 1);
  const seen = markSeen(fired);
  assert.equal(unseenAlerts(seen).length, 0);
  assert.equal(markSeen(seen), seen, "no-op returns the same array");
});

test("one alert per game; editing replaces it; deleting removes it", () => {
  let alerts = upsertAlert([], makeAlert(game(1999), 999, "US"));
  alerts = upsertAlert(alerts, makeAlert(game(1999), 1499, "US"));
  assert.equal(alerts.length, 1);
  assert.equal(alertFor(alerts, 10).targetCents, 1499);
  assert.deepEqual(removeAlert(alerts, 10), []);
});

test("money input is read in the usual ways", () => {
  assert.equal(parseMoney("4.99"), 499);
  assert.equal(parseMoney("$4.99"), 499);
  assert.equal(parseMoney("4,99 €"), 499);
  assert.equal(parseMoney("10"), 1000);
  assert.equal(parseMoney("1.234,56"), 123456);
  assert.equal(parseMoney("1,234.5"), 123450);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("0"), null);
  assert.equal(parseMoney("abc"), null);
});
