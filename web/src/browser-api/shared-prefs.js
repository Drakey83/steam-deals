// Hand edits to "Your taste" (settings.tasteTags), shared on the relay ("prefs", revision "prev" in the signal
// record) with every paired device. The most recent edit wins; when this browser joins a channel, its edits and
// the channel's are combined (src/shared/sharing.js). Relay errors are thrown to the caller (pairing.js).
import { emit } from "./events.js";
import { relay } from "./relay.js";
import { saveSettings, settings } from "./settings.js";
import { store } from "./store.js";

const Sharing = window.SteamSharing;
const REV_KEY = "sd:pairprev"; // revision of the shared edits last merged here

let lastSeen = Number(store.get(REV_KEY, 0)) || 0;
let remote = null; // the relay's edits as last read or written (null = not read yet)
let busy = false;

function seen(rev) {
  lastSeen = rev || 0;
  store.set(REV_KEY, lastSeen);
}

function adopt(prefs, rev, { combine = false } = {}) {
  remote = prefs?.tasteTags || null;
  const merged = Sharing.mergeTasteTags(settings.tasteTags, remote, { combine });
  const changed = !Sharing.sameTasteTags(merged, settings.tasteTags);
  settings.tasteTags = merged;
  saveSettings();
  seen(rev);
  if (changed) emit("settings:changed", { tasteTags: merged });
}

export const prefsStale = (sig) => (sig.prev || 0) !== lastSeen && !busy;

export async function pullPrefs(id, opts) {
  const r = await relay({ action: "prefs.get", pairId: id });
  adopt(r.prefs, r.rev, opts);
  await pushPrefs(id);
}

/** This browser's edits changed: write them to the relay (merging first if another device wrote meanwhile). */
export async function pushPrefs(id) {
  if (busy) return;
  busy = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (remote && Sharing.sameTasteTags(settings.tasteTags, remote)) return;
      const r = await relay({ action: "prefs.set", pairId: id, prefs: { tasteTags: settings.tasteTags || {} }, rev: lastSeen });
      if (r.applied) {
        remote = r.prefs?.tasteTags || settings.tasteTags;
        seen(r.rev);
        return;
      }
      adopt(r.prefs, r.rev);
    }
  } finally {
    busy = false;
  }
}

/** Joining a channel: this browser's edits and the channel's are combined. */
export async function joinPrefs(id) {
  seen(0);
  remote = null;
  await pullPrefs(id, { combine: true });
}

/** The channel is gone from this browser (the edits themselves stay). */
export function forgetPrefs() {
  store.del(REV_KEY);
  lastSeen = 0;
  remote = null;
}
