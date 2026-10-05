// Loading price history for the games on screen (the maths is in logic/history.js). Asks window.steamDeals in
// batches, remembers the answers for this session, and announces new data (EV.historyLoaded) so the views can
// add badges in place. If the host reports history as unavailable, it stops asking.
import { EV, emit } from "./lib/events.js";
import { api } from "./lib/platform.js";
import { state } from "./state.js";

const BATCH = 200;
const entries = new Map(); // `${country}:${appid}` → { low, points? } | null (asked, no data)
const inFlight = new Set();
let available = Boolean(api.history);

const keyFor = (appid) => `${state.settings?.country || "US"}:${appid}`;

/** What's known about a game's history: undefined (not asked yet), null (no data), or the entry. */
export const historyOf = (appid) => entries.get(keyFor(appid));

export const historyAvailable = () => available;

/** Make sure history is loaded (or loading) for these games. */
export async function loadHistory(appids) {
  if (!available) return;
  const wanted = [...new Set(appids)].filter((a) => !entries.has(keyFor(a)) && !inFlight.has(keyFor(a)));
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    batch.forEach((a) => inFlight.add(keyFor(a)));
    const r = await api.history.get(batch).catch(() => null);
    batch.forEach((a) => inFlight.delete(keyFor(a)));
    if (!r?.ok) continue; // try again on the next render
    if (r.enabled === false) {
      available = false;
      return;
    }
    for (const a of batch) entries.set(keyFor(a), r.items?.[a] ?? null);
    emit(EV.historyLoaded, batch);
  }
}

/** The 90-day price log for one game (for the details panel). Resolves to the entry, or null. */
export async function loadPoints(appid) {
  if (!available) return null;
  const known = historyOf(appid);
  if (known && "points" in known) return known;
  const r = await api.history.get([appid], { points: true }).catch(() => null);
  if (!r?.ok) return null;
  if (r.enabled === false) {
    available = false;
    return null;
  }
  const entry = r.items?.[appid] ?? null;
  entries.set(keyFor(appid), entry);
  return entry;
}
