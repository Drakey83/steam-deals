// Price alerts made in this browser, shared on the relay ("alerts", revision "arev" in the signal record).
// The paired Windows app checks them and shows the notification, and writes back what fired, which this browser
// picks up the same way. The merge rules are in src/shared/sharing.js. Relay errors are thrown to the caller
// (pairing.js decides what a pairing the relay no longer knows means).
import { emit } from "./events.js";
import { relay } from "./relay.js";
import { saveSettings, settings } from "./settings.js";
import { store } from "./store.js";

const Sharing = window.SteamSharing;
const REV_KEY = "sd:pairarev"; // revision of the relay's alert list last merged here
const MINE_KEY = "sd:pairmine"; // alerts made in this browser (keys), which it takes back if it alone unpairs

let lastSeen = Number(store.get(REV_KEY, 0)) || 0;
let busy = false;
let again = false;

function seen(rev) {
  lastSeen = rev || 0;
  store.set(REV_KEY, lastSeen);
}

/** Make the relay's alert list this browser's alerts. */
function adopt(list, rev) {
  const next = Array.isArray(list) ? list : [];
  const changed = !Sharing.sameAlerts(next, settings.alerts || []);
  settings.alerts = next;
  saveSettings();
  seen(rev);
  if (changed) emit("settings:changed", { alerts: next });
}

const mineKeys = () => new Set(store.get(MINE_KEY, []) || []);
function addMine(alerts) {
  const mine = mineKeys();
  for (const a of alerts || []) mine.add(Sharing.alertKey(a));
  store.set(MINE_KEY, [...mine].slice(-400));
}

/** The signal says the relay's alerts moved past what we merged (and we're not mid-write). */
export const alertsStale = (sig) => (sig.arev || 0) !== lastSeen && !busy;

export async function pullAlerts(id) {
  const r = await relay({ action: "alerts.get", pairId: id });
  adopt(r.alerts, r.rev);
}

/** This browser's alerts changed (from `prev`): write them, keeping the app's newer check state if it wrote first. */
export async function pushAlerts(id, prev) {
  if (prev) {
    const before = new Set(prev.map(Sharing.alertKey));
    addMine((settings.alerts || []).filter((a) => !before.has(Sharing.alertKey(a))));
  }
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    do {
      again = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await relay({ action: "alerts.set", pairId: id, alerts: Sharing.tagWebAlerts(settings.alerts || []), rev: lastSeen });
        if (r.applied) {
          adopt(r.alerts, r.rev);
          break;
        }
        // The app wrote first (an alert fired): keep this browser's alerts, take the app's check state.
        settings.alerts = Sharing.rebaseWebAlerts(settings.alerts || [], r.alerts);
        saveSettings();
        seen(r.rev);
      }
    } while (again);
  } finally {
    busy = false;
  }
}

/** Joining a channel: this browser's alerts join any already shared there. */
export async function joinAlerts(id) {
  addMine(settings.alerts);
  const shared = await relay({ action: "alerts.get", pairId: id });
  seen(shared.rev);
  settings.alerts = Sharing.tagWebAlerts([...(settings.alerts || []), ...(shared.alerts || [])]);
  if (settings.alerts.length) await pushAlerts(id);
  else adopt(shared.alerts, shared.rev);
}

/** Alerts this browser had before it could share them (paired before alerts synced): share them now. */
export function shareOlderAlerts(id) {
  const unshared = (settings.alerts || []).filter((a) => a.origin !== "web");
  if (!unshared.length) return null;
  addMine(unshared);
  return pushAlerts(id);
}

/**
 * Leaving a channel on its own, this browser takes back the alerts it made: they leave the shared list (so the
 * app stops checking them) and this browser checks them itself again. Alerts other browsers made stay with them.
 */
export async function takeBackAlerts(id) {
  const mine = mineKeys();
  if (id && mine.size) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const cur = await relay({ action: "alerts.get", pairId: id });
        const rest = (cur.alerts || []).filter((a) => !mine.has(Sharing.alertKey(a)));
        if (rest.length === (cur.alerts || []).length) break;
        const w = await relay({ action: "alerts.set", pairId: id, alerts: rest, rev: cur.rev || 0 });
        if (w.applied) break;
      } catch {
        break; // the relay is gone or unreachable: nothing left to take back
      }
    }
  }
  const kept = (settings.alerts || []).filter((a) => mine.has(Sharing.alertKey(a)));
  const changed = kept.length !== (settings.alerts || []).length;
  settings.alerts = kept;
  saveSettings();
  if (changed) emit("settings:changed", { alerts: kept });
}

/** The channel is gone from this browser: forget what was shared (the alerts themselves stay). */
export function forgetAlerts() {
  store.del(REV_KEY);
  store.del(MINE_KEY);
  lastSeen = 0;
}
