// Whole documents a channel shares, each replaced only if nobody changed it since the writer last read it:
// the website's price alerts (revision "arev") and the shared preferences ("prev": filters, "Your taste" edits,
// Not interested, behaviour; src/shared/sharing.js). A refused write hands back what's there now, so the writer can
// merge and try again. Apps older than 1.15 send only { tasteTags }: the rest of the document is kept for them.
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

async function write(db, doc, id, value, expected, current = null) {
  const clean = doc.clean(current ? { ...current, ...value } : value);
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
    const id = await alive();
    const prefs = body.prefs && typeof body.prefs === "object" ? body.prefs : {};
    // A partial write (an older app) keeps what it didn't send. Read first: the write still only lands if nobody
    // changed the document since `rev`, so what's kept is exactly what the writer saw.
    const partial = Object.keys(DOCS.prefs.clean({})).some((k) => !(k in prefs));
    const current = partial ? (await read(db, DOCS.prefs, id)).prefs : null;
    return write(db, DOCS.prefs, id, prefs, int(body.rev), current);
  },
};
