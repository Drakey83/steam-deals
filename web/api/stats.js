// Anonymous user counter. Each browser sends a random id it generated itself; ids go into Redis
// HyperLogLogs, which can count distinct values but can't list them. Nothing personal is stored.
// Works with Upstash Redis added through Vercel's Storage tab (free plan). Without it, the counter
// reports `enabled: false` and the page simply hides it.
const { send, handler, readJsonBody, HttpError } = require("./_lib/server.js");
const { redisClient } = require("./_lib/redis.js");

// ISO week key, e.g. "2026-W40", so "this week" resets every Monday (UTC).
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

module.exports = handler(async (req, res) => {
  const db = redisClient({ message: "The counter is unavailable right now.", code: "counter_down" });
  if (!db) return send(res, 200, { enabled: false }, { cache: "public, max-age=300, s-maxage=300" });
  const wk = `sd:users:${weekKey()}`;

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    const id = String(body.id || "");
    if (!/^[a-f0-9-]{32,36}$/i.test(id)) throw new HttpError(400, "Bad id.", "bad_input");
    const [, , , total, week] = await db.pipeline([
      ["PFADD", "sd:users:all", id],
      ["PFADD", wk, id],
      ["EXPIRE", wk, 1209600],
      ["PFCOUNT", "sd:users:all"],
      ["PFCOUNT", wk],
    ]);
    return send(res, 200, { enabled: true, total, week });
  }

  const [total, week] = await db.pipeline([["PFCOUNT", "sd:users:all"], ["PFCOUNT", wk]]);
  send(res, 200, { enabled: true, total, week }, { cache: "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" });
});
