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
async function signIn(parent, { fresh = false } = {}) {
  if (fresh) {
    // Re-authenticating (the store stopped honouring the session, e.g. after a password change):
    // a stale cookie would otherwise make this look signed in without ever showing Steam's page.
    await signOut().catch(() => {});
  } else {
    const existing = await readSteamId().catch(() => null);
    if (existing) return { ok: true, steamid: existing };
  }

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

/**
 * Keep the Steam sign-in alive the way a browser does: load the store front page in a hidden window on the
 * same cookie partition and let Steam's own page renew the login (that is what "Remember me" is for). The
 * app never looks at the page; afterwards it only checks whether the store still knows the SteamID.
 * Resolves the SteamID64, or null if Steam no longer considers this device signed in.
 */
let keepAliveRun = null;
function keepAlive({ timeoutMs = 12000 } = {}) {
  if (keepAliveRun) return keepAliveRun;
  keepAliveRun = new Promise((resolve) => {
    let win;
    try {
      win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
    } catch {
      return resolve(null);
    }
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const id = await readSteamId().catch(() => null);
      if (!win.isDestroyed()) win.destroy();
      resolve(id);
    };
    const timer = setTimeout(finish, timeoutMs);
    // Give the page a moment after it loads: the renewal is a short exchange the store page performs itself.
    win.webContents.on("did-finish-load", () => setTimeout(finish, 3500));
    win.webContents.on("did-fail-load", () => finish());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.loadURL("https://store.steampowered.com/").catch(() => finish());
  }).finally(() => {
    keepAliveRun = null;
  });
  return keepAliveRun;
}

/** Wipe the Steam cookie jar and caches. */
async function signOut() {
  const ses = steamSession();
  await ses.clearStorageData();
  await ses.clearCache().catch(() => {});
}

module.exports = { PARTITION, steamSession, sessionFetch, readSteamId, signIn, signOut, keepAlive };
