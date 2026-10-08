// The shared preferences (filters and view, "Your taste" edits, Not interested, behaviour), one document on the
// relay ("prefs", revision "prev" in the signal record) that every paired device keeps the same. The merge rules
// are in src/shared/sharing.js; when this browser joins a channel, both sides' taste edits are combined. Relay
// errors are thrown to the caller (pairing.js).
import { emit } from "./events.js";
import { relay } from "./relay.js";
import { saveSettings, settings } from "./settings.js";
import { store } from "./store.js";

const Sharing = window.SteamSharing;
const REV_KEY = "sd:pairprev"; // revision of the shared preferences last merged here

let lastSeen = Number(store.get(REV_KEY, 0)) || 0;
let remote = null; // the relay's document as last read or written (null = not read yet)
let busy = false;
let again = false; // a change arrived while a write was under way: write once more after it

function seen(rev) {
  lastSeen = rev || 0;
  store.set(REV_KEY, lastSeen);
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function adopt(prefs, rev, { combine = false } = {}) {
  remote = prefs || null;
  const merged = Sharing.settingsFromPrefs(Sharing.mergePrefs(Sharing.prefsFromSettings(settings), remote, { combine }));
  const changed = Object.fromEntries(Object.entries(merged).filter(([k, v]) => !sameValue(v, settings[k])));
  Object.assign(settings, changed);
  saveSettings();
  seen(rev);
  if (Object.keys(changed).length) emit("settings:changed", changed);
}

// Also once per page load (nothing read yet), so a change that didn't get out last time is sent now.
export const prefsStale = (sig) => (remote === null || (sig.prev || 0) !== lastSeen) && !busy;

export async function pullPrefs(id, opts) {
  const r = await relay({ action: "prefs.get", pairId: id });
  adopt(r.prefs, r.rev, opts);
  await pushPrefs(id);
}

/** This browser's preferences changed: write them to the relay (merging first if another device wrote meanwhile). */
export async function pushPrefs(id) {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  again = false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const mine = Sharing.prefsFromSettings(settings);
      if (remote && Sharing.samePrefs(mine, remote)) return;
      const r = await relay({ action: "prefs.set", pairId: id, prefs: mine, rev: lastSeen });
      if (r.applied) {
        remote = r.prefs || mine;
        seen(r.rev);
        return;
      }
      adopt(r.prefs, r.rev);
    }
  } finally {
    busy = false;
    if (again) await pushPrefs(id);
  }
}

/** Joining a channel: this browser's preferences and the channel's are merged (taste edits combined). */
export async function joinPrefs(id) {
  seen(0);
  remote = null;
  await pullPrefs(id, { combine: true });
}

/** The channel is gone from this browser (the preferences themselves stay). */
export function forgetPrefs() {
  store.del(REV_KEY);
  lastSeen = 0;
  remote = null;
}
