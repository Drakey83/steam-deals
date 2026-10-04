// Sign in through Steam.
//
// We open Steam's own login page in an isolated window with a persistent cookie
// partition. The user signs in there (password, Steam Guard, QR — whatever Steam
// shows). We never touch that page's contents. The only thing we read is the
// `steamLoginSecure` cookie Steam sets on store.steampowered.com, whose value starts
// with the user's SteamID64. That same cookie jar is then used to ask the store which
// apps the account owns.
const { BrowserWindow, session, shell } = require("electron");

const PARTITION = "persist:steam";
const LOGIN_URL = "https://store.steampowered.com/login/?redir=%2F&redir_ssl=1";
const STEAM_HOSTS = /(^|\.)(steampowered\.com|steamcommunity\.com|steamstatic\.com|akamaihd\.net|recaptcha\.net|google\.com|gstatic\.com)$/i;

function steamSession() {
  return session.fromPartition(PARTITION);
}

/** fetch bound to the Steam cookie jar, for store endpoints that need the login session. */
function sessionFetch(url, init = {}) {
  return steamSession().fetch(url, { credentials: "include", ...init });
}

/** SteamID64 from the store login cookie, or null when signed out. */
async function readSteamId() {
  const cookies = await steamSession().cookies.get({ url: "https://store.steampowered.com", name: "steamLoginSecure" });
  for (const c of cookies) {
    let value = c.value ?? "";
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw */
    }
    const m = value.match(/^(7656119\d{10})\|\|/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Show Steam's login page and resolve once the store session cookie appears.
 * Resolves { ok: true, steamid } | { ok: false, cancelled: true }.
 */
async function signIn(parent) {
  const existing = await readSteamId().catch(() => null);
  if (existing) return { ok: true, steamid: existing };

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 840,
      minWidth: 420,
      minHeight: 600,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      show: false,
      autoHideMenuBar: true,
      title: "Sign in through Steam",
      backgroundColor: "#171a21",
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    let done = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      if (!win.isDestroyed()) win.close();
      resolve(result);
    };
    const check = async () => {
      if (done) return;
      const id = await readSteamId().catch(() => null);
      if (id) finish({ ok: true, steamid: id });
    };

    timer = setInterval(check, 1000);
    win.webContents.on("did-navigate", check);
    win.webContents.on("did-navigate-in-page", check);
    win.webContents.on("did-finish-load", check);
    win.on("closed", () => finish({ ok: false, cancelled: true }));
    win.once("ready-to-show", () => win.show());

    // Keep the login window on Steam. Anything else (help links, etc.) goes to the system browser.
    const allowed = (url) => {
      try {
        return STEAM_HOSTS.test(new URL(url).hostname);
      } catch {
        return false;
      }
    };
    win.webContents.on("will-navigate", (e, url) => {
      if (!allowed(url)) {
        e.preventDefault();
        if (/^https?:/i.test(url)) shell.openExternal(url);
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });

    win.loadURL(LOGIN_URL);
  });
}

/** Wipe the Steam cookie jar and caches. */
async function signOut() {
  const ses = steamSession();
  await ses.clearStorageData();
  await ses.clearCache().catch(() => {});
}

module.exports = { PARTITION, steamSession, sessionFetch, readSteamId, signIn, signOut };
