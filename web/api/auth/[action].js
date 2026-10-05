// "Sign in through Steam" (OpenID 2.0), as one function so the site stays within the Hobby plan's limit of
// 12 serverless functions per deployment. The URLs are unchanged:
//   /api/auth/login     start sign-in (redirects to Steam)
//   /api/auth/callback  Steam redirects back here; the assertion is verified with Steam before it's trusted
//   /api/auth/logout    POST: clear the session cookie
const { HttpError } = require("../_lib/server.js");

const ACTIONS = {
  login: require("../_lib/auth/login.js"),
  callback: require("../_lib/auth/callback.js"),
  logout: require("../_lib/auth/logout.js"),
};

module.exports = (req, res) => {
  const action = ACTIONS[String(req.query?.action || "")];
  if (action) return action(req, res);
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: { message: new HttpError(404, "Not found.").message, code: "not_found" } }));
};
