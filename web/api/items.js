// Up to 50 games by app id, straight from Steam's store.
//   default   name, type and weighted tags (used to learn a visitor's taste from their library); cached for weeks
//   ?full=1   the full card for each game, including the current price (used by price alerts and wishlist
//             games that aren't in the sale scan); cached for 3 hours, like the deal pages
const core = require("./_lib/core.js");
const { API, steamJSON, send, handler, storeParams, HttpError } = require("./_lib/server.js");

module.exports = handler(async (req, res) => {
  const q = req.query || {};
  const ids = String(q.ids || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length || ids.length > 50) throw new HttpError(400, "Send between 1 and 50 app ids.", "bad_input");
  const { country, language } = storeParams(q);
  const full = q.full === "1";
  const input = {
    ids: ids.map((appid) => ({ appid })),
    context: { language, country_code: country, steam_realm: 1 },
    data_request: full
      ? { include_basic_info: true, include_reviews: true, include_release: true, include_tag_count: 8, include_platforms: true }
      : { include_basic_info: true, include_tag_count: 20 },
  };
  const data = await steamJSON(`${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
  const raw = (data?.response?.store_items || []).filter((it) => it && it.success !== false);
  if (full) {
    const items = raw.map((it) => core.normalizeItem(it, { requireDiscount: false })).filter(Boolean);
    return send(res, 200, { items }, { cache: "public, max-age=600, s-maxage=10800, stale-while-revalidate=86400" });
  }
  const items = raw.map((it) => ({ appid: it.appid, name: it.name || null, type: typeof it.type === "number" ? it.type : null, tags: core.normTags(it.tags) }));
  send(res, 200, { items }, { cache: "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000" });
});
