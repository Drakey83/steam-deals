// Where is this visitor, roughly? Vercel adds country and region headers from the connection's
// address. Used only to preselect the basket's tax region; the person can change it. Nothing is stored.
const core = require("./_lib/core.js");
const { send, handler } = require("./_lib/server.js");

module.exports = handler(async (req, res) => {
  const country = String(req.headers["x-vercel-ip-country"] || "").toUpperCase();
  const region = String(req.headers["x-vercel-ip-country-region"] || "").toUpperCase();
  const taxRegion = core.taxRegionFor(country, region);
  res.setHeader("Access-Control-Allow-Origin", "*");
  send(res, 200, { country: country || null, region: region || null, taxRegion }, { cache: "private, no-store" });
});
