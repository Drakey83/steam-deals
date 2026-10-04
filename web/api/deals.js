// One page (500 items) of Steam's catalog, normalized. Cached at Vercel's edge for 3 hours so
// every visitor shares one scan and Steam sees very few requests.
const core = require("./_lib/core.js");
const { API, steamJSON, send, handler, storeParams, HttpError } = require("./_lib/server.js");

module.exports = handler(async (req, res) => {
  const q = req.query || {};
  const start = Number(q.start ?? 0);
  if (!Number.isInteger(start) || start < 0 || start > 250000 || start % 500 !== 0) throw new HttpError(400, "Bad start offset.", "bad_input");
  const discounted = q.catalog !== "all";
  const { country, language } = storeParams(q);
  const input = core.buildQueryInput({ start, count: 500, discounted, language, country });
  const data = await steamJSON(`${API}/IStoreQueryService/Query/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
  const raw = data?.response?.store_items || [];
  const items = [];
  for (const it of raw) {
    const n = core.normalizeItem(it, { requireDiscount: discounted });
    if (n && (!discounted || n.discount >= 50)) {
      delete n.image; // the browser rebuilds these from the appid (packageid stays: the cart needs it)
      delete n.url;
      delete n.tagids;
      items.push(n);
    }
  }
  send(
    res,
    200,
    { start, scanned: raw.length, total: data?.response?.metadata?.total_matching_records ?? null, discounted, items, fetchedAt: Date.now() },
    { cache: "public, max-age=300, s-maxage=10800, stale-while-revalidate=86400" },
  );
});
