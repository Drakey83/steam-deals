const { handler, send, clearSessionCookie, HttpError } = require("../_lib/server.js");

module.exports = handler(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.", "method");
  res.setHeader("Set-Cookie", clearSessionCookie());
  send(res, 200, { ok: true });
});
