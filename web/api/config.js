// Tells the page which sign-in options this deployment supports.
const { send, handler, signInConfigured } = require("./_lib/server.js");

module.exports = handler(async (req, res) => {
  send(res, 200, { steamSignIn: signInConfigured() }, { cache: "public, max-age=60, s-maxage=60" });
});
