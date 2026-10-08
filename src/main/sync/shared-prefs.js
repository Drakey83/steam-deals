// The shared preferences (filters and view, "Your taste" edits, Not interested, behaviour), one document on the
// relay ("prefs", revision "prev" in the signal record) that every paired device keeps the same. The merge rules
// are in src/shared/sharing.js; when devices first pair, both sides' taste edits are combined.
const { mergePrefs, samePrefs, prefsFromSettings, settingsFromPrefs } = require("../../shared/sharing.js");

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

module.exports = function createSharedPrefs({ settings, pairApi, sendToUI, log, paused }) {
  let remote = null; // the relay's document as last read or written (null = not read yet)
  let busy = false;
  let again = false; // a change arrived while a write was under way: write once more after it

  /** Take the relay's document and tell the interface what changed here. */
  function adopt(prefs, rev, { combine = false } = {}) {
    const s = settings.get();
    remote = prefs || null;
    const merged = settingsFromPrefs(mergePrefs(prefsFromSettings(s), remote, { combine }));
    const changed = Object.fromEntries(Object.entries(merged).filter(([k, v]) => !sameValue(v, s[k])));
    settings.update({ ...changed, prefsRev: rev || 0 });
    if (Object.keys(changed).length) {
      log(`[sync] from a paired device: ${Object.keys(changed).join(", ")}`);
      sendToUI("settings:changed", changed);
    }
  }

  async function pull({ combine = false } = {}) {
    const r = await pairApi("prefs.get", { pairId: settings.get().pairId });
    adopt(r.prefs, r.rev, { combine });
    await push();
  }

  /** Write this app's document to the relay if it differs (merging first if another device wrote meanwhile). */
  async function push() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    again = false;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const s = settings.get();
        if (!s.pairId || paused()) return;
        const mine = prefsFromSettings(s);
        if (remote && samePrefs(mine, remote)) return;
        const r = await pairApi("prefs.set", { pairId: s.pairId, prefs: mine, rev: s.prefsRev || 0 });
        if (r.applied) {
          remote = r.prefs || mine;
          settings.update({ prefsRev: r.rev || 0 });
          return;
        }
        adopt(r.prefs, r.rev);
      }
    } finally {
      busy = false;
      if (again) await push();
    }
  }

  return {
    // Also once after launch (nothing read yet), so a change that didn't get out last time is sent now.
    isStale: (sig) => remote === null || (sig.prev || 0) !== (settings.get().prefsRev || 0),
    pull,
    push,
    /** Paired or unpaired: forget what the relay had (the preferences themselves stay on this device). */
    reset() {
      remote = null;
    },
  };
};
