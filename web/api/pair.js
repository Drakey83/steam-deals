// The pairing relay: how the Steam Deals Windows app, phones and browsers share one basket, the Steam-cart status,
// price alerts and preferences (filters, Your taste, Not interested). Everything is keyed by a channel id: a random
// one both sides learned from a one-time 6-character code, or a Steam account's own (opened by ./auth/[action].js
// "link"). No account data, no names of people, nothing personal: game ids, names and prices, alert targets, tag
// ids and filter choices.
//
//   start       { pairId? }                        → { code, pairId, expiresIn }   PC asks for a code (10 min);
//                                                                                   with pairId, another device
//   claim       { code }                           → { pairId, rev }               phone/browser redeems a code
//   check       { pairId }                         → { claimed, expired }          PC waits for the code
//   sig         { pairId, touch?, pc?, withCart? } → { rev, arev, prev, active, pc, pcok, pcv, cart? }
//                                                                                   cheap poll: has anything changed?
//   basket.get  { pairId }                         → { rev, items, updatedAt, by }  by: pc | phone | web
//   basket.ops  { pairId, ops, by }                → { rev, items, updatedAt }     add/remove/clear, atomically
//   cart.set    { pairId, cart, ok }               → { ok }                        PC reports Steam-cart status
//   alerts.get  { pairId }                         → { rev, alerts }               the website's price alerts
//   alerts.set  { pairId, alerts, rev }            → { rev, alerts, applied }      replace if unchanged since rev
//   prefs.get   { pairId }                         → { rev, prefs }                { tasteTags, filters, dismissed,
//                                                                                   restored, behavior, behaviorClearedAt }
//   prefs.set   { pairId, prefs, rev }             → { rev, prefs, applied }       same compare-and-set
//   unpair      { pairId }                         → { ok }                        PC closes a code channel
//   send/inbox/ack/status                                                         legacy hand-off (v1.4–1.5 apps)
//
// The actions live in _lib/relay/: channel.js, basket.js, shared-docs.js, legacy.js (records: keys.js, input
// cleaning: clean.js).
const { send, handler, readJsonBody, HttpError } = require("./_lib/server.js");
const { redisClient } = require("./_lib/redis.js");
const { K, PAIR_RE } = require("./_lib/relay/keys.js");

const ACTIONS = {
  ...require("./_lib/relay/channel.js"),
  ...require("./_lib/relay/basket.js"),
  ...require("./_lib/relay/shared-docs.js"),
  ...require("./_lib/relay/legacy.js"),
};

module.exports = handler(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.", "method");
  const db = redisClient({ message: "Pairing is unavailable right now.", code: "pair_down" });
  res.setHeader("Access-Control-Allow-Origin", "*"); // the Windows app calls this too
  if (!db) return send(res, 200, { enabled: false });
  const body = await readJsonBody(req, 400000); // the shared preferences carry the Not interested and behaviour lists
  const act = ACTIONS[String(body.action || "")];
  if (!act || !Object.hasOwn(ACTIONS, String(body.action))) throw new HttpError(400, "Unknown action.", "bad_input");

  const pairId = String(body.pairId || "");
  const needPair = () => {
    if (!PAIR_RE.test(pairId)) throw new HttpError(400, "Not paired.", "bad_pair");
    return pairId;
  };
  /** The channel must still exist (a year idle, or closed, and it's gone). */
  const alive = async () => {
    if (!(await db.command("EXISTS", K.pair(needPair())))) throw new HttpError(404, "This pairing no longer exists. Pair again from the PC.", "bad_pair");
    return pairId;
  };
  send(res, 200, await act({ db, body, needPair, alive, now: Date.now() }));
});
