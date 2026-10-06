// Whole documents a channel shares, each replaced only if nobody changed it since the writer last read it:
// the website's price alerts (revision "arev") and the shared preferences, i.e. "Your taste" edits ("prev").
// A refused write hands back what's there now, so the writer can merge and try again.
const { K, KEEP } = require("./keys.js");
const { int, parse, cleanAlerts, cleanPrefs } = require("./clean.js");

// KEYS[1]=doc KEYS[2]=sig ARGV: expectedRev, docJson, newRev, ttl, revField
const DOC_CAS = `
local cur = redis.call('HGET', KEYS[2], ARGV[5])
if cur == false then cur = '0' end
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('HSET', KEYS[2], ARGV[5], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1`;

const DOCS = {
  alerts: { key: K.alerts, rev: "arev", field: "alerts", clean: cleanAlerts, empty: [] },
  prefs: { key: K.prefs, rev: "prev", field: "prefs", clean: cleanPrefs, empty: {} },
};

async function read(db, doc, id) {
  const [raw, rev] = await db.pipeline([["GET", doc.key(id)], ["HGET", K.sig(id), doc.rev]]);
  return { rev: Number(rev) || 0, [doc.field]: doc.clean(parse(raw, doc.empty)) };
}

async function write(db, doc, id, value, expected) {
  const clean = doc.clean(value);
  const ok = await db.command("EVAL", DOC_CAS, 2, doc.key(id), K.sig(id), String(expected), JSON.stringify(clean), String(expected + 1), String(KEEP), doc.rev);
  if (ok === 1) return { rev: expected + 1, [doc.field]: clean, applied: true };
  return { ...(await read(db, doc, id)), applied: false };
}

module.exports = {
  async "alerts.get"({ db, alive }) {
    return read(db, DOCS.alerts, await alive());
  },
  async "alerts.set"({ db, body, alive }) {
    return write(db, DOCS.alerts, await alive(), body.alerts, int(body.rev));
  },
  async "prefs.get"({ db, alive }) {
    return read(db, DOCS.prefs, await alive());
  },
  async "prefs.set"({ db, body, alive }) {
    return write(db, DOCS.prefs, await alive(), body.prefs, int(body.rev));
  },
};
