// The one-shot basket hand-off that Windows apps 1.4 and 1.5 used before the shared basket. Still answered so
// those apps keep working; nothing current calls it.
const { HttpError } = require("../server.js");
const { K, DAY } = require("./keys.js");
const { MAX_ITEMS, str, int, parse } = require("./clean.js");

async function inbox({ db, needPair }) {
  return { box: parse(await db.command("GET", K.box(needPair())), null) };
}

module.exports = {
  async send({ db, body, needPair, now }) {
    const id = needPair();
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i) => ({ appid: int(i.appid), packageid: int(i.packageid) || null }))
      .filter((i) => i.appid > 0)
      .slice(0, MAX_ITEMS);
    if (!items.length) throw new HttpError(400, "The basket is empty.", "bad_input");
    const box = { items, sentAt: now, status: "sent", result: null };
    await db.command("SET", K.box(id), JSON.stringify(box), "EX", DAY);
    return { sentAt: box.sentAt };
  },
  inbox,
  status: inbox,
  async ack({ db, body, needPair, now }) {
    const id = needPair();
    const box = parse(await db.command("GET", K.box(id)), null);
    if (!box) return { ok: true };
    if (Number(body.sentAt) !== box.sentAt) return { ok: true, stale: true };
    const status = ["received", "added", "failed"].includes(body.status) ? body.status : "received";
    const result = body.result && typeof body.result === "object" ? { added: int(body.result.added), subtotal: str(body.result.subtotal, 40), message: str(body.result.message, 200) } : null;
    await db.command("SET", K.box(id), JSON.stringify({ ...box, status, result, ackedAt: now }), "EX", 3600);
    return { ok: true };
  },
};
