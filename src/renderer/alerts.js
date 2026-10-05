// Checking price alerts (the rules are in logic/alerts.js). Runs after every catalog scan and every few hours
// while the app is open (the desktop app keeps running in the tray). Prices come from the scan; alert games
// that aren't in it (not on sale, or wishlist games) are looked up through window.steamDeals.items.
import { EV, emit } from "./lib/events.js";
import { fmtCents } from "./lib/format.js";
import { api } from "./lib/platform.js";
import { checkAlerts, markSeen } from "./logic/alerts.js";
import { alertList, patchSettings, state } from "./state.js";
import { toast } from "./ui/toast.js";

const LOOKUP_BATCH = 100;
export const RECHECK_MS = 3 * 60 * 60 * 1000;
let running = false;

/** Save a new alert list and let the views catch up. */
export function saveAlerts(list) {
  patchSettings({ alerts: list }, { persistNow: true });
  emit(EV.alertsChanged);
}

async function currentPrices(appids) {
  const prices = new Map();
  for (const d of state.deals) if (Number.isFinite(d.priceCents)) prices.set(d.appid, d.priceCents);
  const missing = appids.filter((a) => !prices.has(a));
  for (let i = 0; i < missing.length && api.items?.lookup; i += LOOKUP_BATCH) {
    const r = await api.items.lookup(missing.slice(i, i + LOOKUP_BATCH)).catch(() => null);
    for (const d of r?.ok ? r.items || [] : []) if (Number.isFinite(d.priceCents)) prices.set(d.appid, d.priceCents);
  }
  return prices;
}

/** Compare every alert with current prices; fire (once per crossing) and save. */
export async function runAlertCheck() {
  if (running || !state.settings) return;
  const country = state.settings.country;
  const mine = alertList().filter((a) => a.country === country);
  if (!mine.length) return;
  running = true;
  try {
    const prices = await currentPrices(mine.map((a) => a.appid));
    const before = alertList(); // re-read: the person may have edited alerts while prices were loading
    const { alerts, triggered } = checkAlerts(before, prices, country);
    if (alerts !== before) saveAlerts(alerts);
    if (!triggered.length) return;
    const money = (a, cents) => fmtCents(cents, a.priceSample);
    toast(triggered.length === 1
      ? `Price alert: ${triggered[0].name} is ${money(triggered[0], triggered[0].triggeredCents)}`
      : `${triggered.length} games hit your price alerts`, { type: "ok", timeout: 9000 });
    api.alerts?.notify(triggered.map((a) => ({ name: a.name, priceText: money(a, a.triggeredCents), targetText: money(a, a.targetCents) })));
  } finally {
    running = false;
  }
}

/** The alerts panel was opened: fired alerts count as seen (clears the badge). */
export function markAlertsSeen() {
  const before = alertList();
  const after = markSeen(before);
  if (after !== before) saveAlerts(after);
}
