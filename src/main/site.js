// The Steam Deals website the app talks to for pairing, price history and the tax-region guess.
// Override only for testing against another deployment.
const SITE = process.env.STEAM_DEALS_SITE || "https://steamdeal.vercel.app";

module.exports = { SITE };
