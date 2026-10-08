// Helpers shared by the website's serverless functions (Vercel, Node 20+).
const crypto = require("node:crypto");

const API = "https://api.steampowered.com";
const COMMUNITY = "https://steamcommunity.com";

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || "error";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON from Steam with a couple of retries on 429/5xx. */
async function steamJSON(url, { retries = 2, timeoutMs = 20000 } = {}) {
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt >= retries) throw new HttpError(502, "Couldn't reach Steam. Try again in a moment.", "network");
      await sleep(delay);
      delay *= 2;
      continue;
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new HttpError(502, "Steam sent a response we couldn't read.", "bad_json");
      }
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(403, "Steam rejected the request.", "forbidden");
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(delay);
      delay *= 2;
      continue;
    }
    throw new HttpError(502, res.status === 429 ? "Steam is rate-limiting requests right now. Try again shortly." : `Steam answered HTTP ${res.status}.`, res.status === 429 ? "rate_limited" : "upstream");
  }
}

async function fetchProfile(steamid) {
  try {
    const res = await fetch(`${COMMUNITY}/profiles/${encodeURIComponent(steamid)}/?xml=1`, { signal: AbortSignal.timeout(10000) });
    const xml = await res.text();
    const pick = (tag) => {
      const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
      return m ? m[1].trim() : null;
    };
    return { name: pick("steamID"), avatar: pick("avatarFull") || pick("avatarMedium") };
  } catch {
    return { name: null, avatar: null };
  }
}

async function fetchWishlist(steamid) {
  try {
    const res = await steamJSON(`${API}/IWishlistService/GetWishlist/v1/?steamid=${encodeURIComponent(steamid)}`, { retries: 1 });
    return (res?.response?.items || []).map((i) => i.appid).filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** Owned games with playtime. Throws HttpError with code "private" when Steam hides them. */
async function fetchOwned(apiKey, steamid) {
  const url =
    `${API}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid)}` +
    `&include_appinfo=1&include_played_free_games=1&include_free_sub=1`;
  let res;
  try {
    res = await steamJSON(url, { retries: 1 });
  } catch (err) {
    if (err.code === "forbidden") throw new HttpError(401, "Steam rejected that API key.", "bad_key");
    throw err;
  }
  const games = res?.response?.games;
  if (!Array.isArray(games)) {
    throw new HttpError(403, "Steam didn't return any games. Set your profile's Game details to Public, or use your own API key.", "private");
  }
  return games.map((g) => ({
    appid: g.appid,
    name: g.name || null,
    playtime: Number(g.playtime_forever) || 0,
    recent: Number(g.playtime_2weeks) || 0,
  }));
}

async function resolveVanity(apiKey, vanity) {
  const res = await steamJSON(`${API}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`, { retries: 1 });
  if (res?.response?.success !== 1 || !res.response.steamid) throw new HttpError(404, "That Steam profile name wasn't found.", "not_found");
  return res.response.steamid;
}

// ---------- signed session cookie (Steam sign-in) ----------
const COOKIE = "sd_session";
const SESSION_DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new HttpError(503, "Sign-in isn't configured on this site.", "not_configured");
  return s;
}
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

function makeSessionCookie(steamid) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${steamid}.${exp}`;
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readSession(req) {
  const raw = String(req.headers.cookie || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [steamid, exp, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!steamid || !exp || !mac) return null;
  const expected = sign(`${steamid}.${exp}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  return { steamid };
}

const signInConfigured = () => Boolean(process.env.STEAM_API_KEY && (process.env.SESSION_SECRET || "").length >= 32);

function origin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host);
  return `${proto}://${host}`;
}

// ---------- request plumbing ----------
function send(res, status, body, { cache = "no-store" } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

/** Wrap a handler: uniform JSON errors, never echo secrets. */
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : "Something went wrong on the server.";
      if (!(err instanceof HttpError)) console.error("[api]", err && err.stack ? err.stack.split("\n")[0] : err);
      send(res, status, { error: { message, code: err.code || "error" } });
    }
  };
}

async function readJsonBody(req, max = 10000) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new HttpError(413, "Request too large.", "too_large");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Request body must be JSON.", "bad_json");
  }
}

const CC = /^[A-Z]{2}$/;
const LANG = /^[a-z]{3,12}$/;
function storeParams(q) {
  const country = CC.test(String(q.cc || "")) ? q.cc : "US";
  const language = LANG.test(String(q.l || "")) ? q.l : "english";
  return { country, language };
}

module.exports = {
  API,
  HttpError,
  steamJSON,
  fetchProfile,
  fetchWishlist,
  fetchOwned,
  resolveVanity,
  makeSessionCookie,
  clearSessionCookie,
  readSession,
  signInConfigured,
  origin,
  send,
  handler,
  readJsonBody,
  storeParams,
};
