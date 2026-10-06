// Price alerts made on the website, on the relay ("alerts", revision "arev" in the signal record).
// This app adds them to its own list, checks them with its own alerts (the interface does the checking,
// renderer/alerts.js) and shows the notification; it writes back what fired. The merge rules are in
// src/shared/sharing.js: this app owns the check state, the website owns which alerts exist.
const { mergeWebAlerts, webAlertsForRelay, sameAlerts, withoutWebAlerts, alertKey } = require("../../shared/sharing.js");

const ADOPT_GRACE_MS = 5000; // an interface save this soon after website alerts arrived may not include them yet

module.exports = function createSharedAlerts({ settings, pairApi, sendToUI, log, paused }) {
  let remote = null; // the relay's list as last read or written (null = not read yet)
  let busy = false;
  let again = false;
  let adopted = { keys: new Set(), at: 0 }; // website alerts that just arrived, and when

  /** Fold the relay's list (revision `rev`) into this app's alerts and tell the interface. */
  function adopt(list, rev) {
    const s = settings.get();
    remote = Array.isArray(list) ? list : [];
    const merged = mergeWebAlerts(s.alerts, remote);
    const changed = !sameAlerts(merged, s.alerts || []);
    const had = new Set((s.alerts || []).map(alertKey));
    adopted = { keys: new Set(merged.filter((a) => !had.has(alertKey(a))).map(alertKey)), at: Date.now() };
    settings.update({ alerts: merged, alertsRev: rev || 0 });
    if (changed) {
      log(`[sync] alerts from the website: ${remote.length}`);
      sendToUI("settings:changed", { alerts: merged });
    }
  }

  /** The relay's alerts changed: take them, then send back anything this app knows that the relay doesn't. */
  async function pull() {
    const r = await pairApi("alerts.get", { pairId: settings.get().pairId });
    adopt(r.alerts, r.rev);
    await push();
  }

  /** Write this app's copies of the website alerts (check state, fired) to the relay, merging if it moved. */
  async function push() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const s = settings.get();
          if (!s.pairId || paused()) return;
          if (!remote) {
            const r = await pairApi("alerts.get", { pairId: s.pairId });
            adopt(r.alerts, r.rev);
            continue;
          }
          const out = webAlertsForRelay(settings.get().alerts, remote);
          if (sameAlerts(out, remote)) break;
          const r = await pairApi("alerts.set", { pairId: s.pairId, alerts: out, rev: settings.get().alertsRev || 0 });
          if (r.applied) {
            remote = r.alerts || out;
            settings.update({ alertsRev: r.rev || 0 });
            break;
          }
          adopt(r.alerts, r.rev); // the website changed them first: merge, then try again
        }
      } while (again);
    } finally {
      busy = false;
    }
  }

  return {
    /** The signal says the relay's alerts moved past what we merged. */
    isStale: (sig) => (sig.arev || 0) !== (settings.get().alertsRev || 0),
    pull,
    push,
    /** Just paired: read the relay's list fresh. */
    reset() {
      remote = null;
    },
    /** The pairing ended: alerts made on the website stay there (it checks them itself again), not here. */
    drop() {
      remote = null;
      const s = settings.get();
      const own = withoutWebAlerts(s.alerts);
      if (own.length === (s.alerts || []).length) return;
      settings.update({ alerts: own, alertsRev: 0 });
      sendToUI("settings:changed", { alerts: own });
    },
    /**
     * The interface is saving `next` alerts. If website alerts arrived moments ago and the save lacks them, it was
     * made from a list that predates them (the interface hadn't caught up), not a deletion: keep them.
     */
    guard(next) {
      if (!Array.isArray(next) || Date.now() - adopted.at > ADOPT_GRACE_MS || !adopted.keys.size) return next;
      const have = new Set(next.map(alertKey));
      const lost = (settings.get().alerts || []).filter((a) => adopted.keys.has(alertKey(a)) && !have.has(alertKey(a)));
      return lost.length ? [...lost, ...next] : next;
    },
  };
};
