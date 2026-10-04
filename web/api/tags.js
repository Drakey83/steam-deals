// Steam's tag dictionary (id -> name) for one store language.
const { API, steamJSON, send, handler, storeParams } = require("./_lib/server.js");

module.exports = handler(async (req, res) => {
  const { language } = storeParams(req.query || {});
  const data = await steamJSON(`${API}/IStoreService/GetTagList/v1/?language=${language}`);
  const tags = {};
  for (const t of data?.response?.tags || []) if (Number.isFinite(t.tagid) && t.name) tags[t.tagid] = t.name;
  send(res, 200, { tags }, { cache: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" });
});
