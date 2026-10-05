// Price alerts: "tell me when this is at or below $X". Pure: no DOM, no network (unit-tested).
//
// An alert fires once per crossing: when an armed alert sees the price at or below its target it fires and
// disarms; it re-arms only after the price is seen above the target again. So a game that stays cheap for a
// week notifies once, and a game that goes back up and drops again notifies again. An alert created while the
// price is already at or below target starts disarmed (there was no crossing to report).
//
// alert = { appid, name, country, targetCents, priceSample, armed, createdAt,
//           lastCents, triggeredAt, triggeredCents, seen }

export const MAX_ALERTS = 200;

/** "4.99", "$4.99", "4,99 €", "1.234,56" → cents (null if it isn't a positive amount). */
export function parseMoney(text) {
  const s = String(text ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const decimals = lastSep >= 0 && s.length - lastSep - 1 <= 2 ? s.slice(lastSep + 1) : "";
  const whole = (decimals ? s.slice(0, lastSep) : s).replace(/[.,]/g, "");
  const cents = Number(whole || "0") * 100 + Number(decimals.padEnd(2, "0") || 0);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

const atOrBelow = (cents, target) => Number.isFinite(cents) && cents <= target;

/** A new alert for game `d` in store `country`. */
export function makeAlert(d, targetCents, country, now = Date.now()) {
  return {
    appid: d.appid,
    name: d.name || `App ${d.appid}`,
    country,
    targetCents,
    priceSample: d.price || null, // a real price string, for formatting money in the same currency
    armed: !atOrBelow(d.priceCents, targetCents),
    createdAt: now,
    lastCents: Number.isFinite(d.priceCents) ? d.priceCents : null,
    triggeredAt: null,
    triggeredCents: null,
    seen: true,
  };
}

/** Add or replace the alert for that game (newest first). Changing the target re-arms it relative to the price. */
export function upsertAlert(alerts, alert) {
  const rest = (alerts || []).filter((a) => a.appid !== alert.appid);
  return [alert, ...rest].slice(0, MAX_ALERTS);
}

export const removeAlert = (alerts, appid) => (alerts || []).filter((a) => a.appid !== appid);

export const alertFor = (alerts, appid) => (alerts || []).find((a) => a.appid === appid) || null;

/**
 * Compare alerts with the latest prices. `prices` maps appid → current price in cents for store `country`
 * (alerts set in another region are left alone; their currency differs). Returns the updated list (the same
 * array when nothing changed) and the alerts that fired just now.
 */
export function checkAlerts(alerts, prices, country, now = Date.now()) {
  const list = alerts || [];
  const triggered = [];
  let changed = false;
  const next = list.map((a) => {
    const cents = prices.get(a.appid);
    if (a.country !== country || !Number.isFinite(cents)) return a;
    let b = a.lastCents === cents ? a : { ...a, lastCents: cents };
    if (a.armed && atOrBelow(cents, a.targetCents)) {
      b = { ...b, armed: false, triggeredAt: now, triggeredCents: cents, seen: false };
      triggered.push(b);
    } else if (!a.armed && !atOrBelow(cents, a.targetCents)) {
      b = { ...b, armed: true }; // back above target: ready to fire on the next drop
    }
    if (b !== a) changed = true;
    return b;
  });
  return { alerts: changed ? next : list, triggered };
}

/** Fired alerts the person hasn't looked at yet (the badge count). */
export const unseenAlerts = (alerts) => (alerts || []).filter((a) => a.triggeredAt && !a.seen);

export function markSeen(alerts) {
  return (alerts || []).some((a) => !a.seen) ? alerts.map((a) => (a.seen ? a : { ...a, seen: true })) : alerts;
}
