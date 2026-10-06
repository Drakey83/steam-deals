// Hand edits to "Your taste" (settings.tasteTags), shared on the relay ("prefs", revision "prev" in the signal
// record) with every paired device. The most recent edit wins; when devices first pair, both sides' edits are
// combined (src/shared/sharing.js).
const { mergeTasteTags, sameTasteTags } = require("../../shared/sharing.js");

module.exports = function createSharedPrefs({ settings, pairApi, sendToUI, log, paused }) {
  let remote = null; // the relay's taste edits as last read or written (null = not read yet)
  let busy = false;

  /** Take the relay's edits and tell the interface if ours changed. */
  function adopt(prefs, rev, { combine = false } = {}) {
    const s = settings.get();
    remote = prefs?.tasteTags || null;
    const merged = mergeTasteTags(s.tasteTags, remote, { combine });
    const changed = !sameTasteTags(merged, s.tasteTags);
    settings.update({ tasteTags: merged, prefsRev: rev || 0 });
    if (changed) {
      log("[sync] taste edits from a paired device");
      sendToUI("settings:changed", { tasteTags: merged });
    }
  }

  async function pull({ combine = false } = {}) {
    const r = await pairApi("prefs.get", { pairId: settings.get().pairId });
    adopt(r.prefs, r.rev, { combine });
    await push();
  }

  /** Write this app's edits to the relay if they differ (merging first if another device wrote meanwhile). */
  async function push() {
    if (busy) return;
    busy = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const s = settings.get();
        if (!s.pairId || paused()) return;
        if (remote && sameTasteTags(s.tasteTags, remote)) return;
        const r = await pairApi("prefs.set", { pairId: s.pairId, prefs: { tasteTags: s.tasteTags || {} }, rev: s.prefsRev || 0 });
        if (r.applied) {
          remote = r.prefs?.tasteTags || s.tasteTags;
          settings.update({ prefsRev: r.rev || 0 });
          return;
        }
        adopt(r.prefs, r.rev);
      }
    } finally {
      busy = false;
    }
  }

  return {
    isStale: (sig) => (sig.prev || 0) !== (settings.get().prefsRev || 0),
    pull,
    push,
    /** Paired or unpaired: forget what the relay had (the edits themselves stay on this device). */
    reset() {
      remote = null;
    },
  };
};
