// The pairing relay's records in Redis, and how long they live. One channel = one random id; every record of a
// channel is keyed by it. Shared by the relay (../../pair.js) and the account link (../auth/link.js), which opens
// a channel for a Steam account.
const DAY = 86400;
const KEEP = 365 * DAY; // a channel lives a year past its last use
const ACTIVE_MS = 120000; // "a phone is looking" lasts this long after its last poll
const BUSY_MS = 30000; // "someone is using this device" lasts this long after the last input it reported
const TAG_RE = /^[a-z0-9]{2,16}$/; // a device's tag in busy mode ("pc", or a browser's random tag)
const PAIR_RE = /^[a-f0-9]{32}$/;

const K = {
  code: (c) => `sd:paircode:${c}`, // a 6-character code -> channel id, for 10 minutes
  pair: (id) => `sd:pair:${id}`, // the channel itself: { createdAt, claimedAt, devices, account? }
  sig: (id) => `sd:sig:${id}`, // the cheap poll: revisions (rev, arev, prev), "a phone is active", "the PC checked in",
  //                                and busy:<tag> = until when that device is being used (busy mode)
  basket: (id) => `sd:basket:${id}`, // { rev, items, updatedAt, by }
  cart: (id) => `sd:cart:${id}`, // the PC's report of what is in the Steam cart
  alerts: (id) => `sd:alerts:${id}`, // price alerts made on the website
  prefs: (id) => `sd:prefs:${id}`, // shared preferences: { tasteTags }
  box: (id) => `sd:pairbox:${id}`, // legacy one-shot hand-off
};

module.exports = { K, KEEP, DAY, ACTIVE_MS, BUSY_MS, TAG_RE, PAIR_RE };
