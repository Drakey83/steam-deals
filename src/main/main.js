// Electron main process entry: one instance, the window, the tray, and the IPC handlers.
//
//   window.js         the app window (size memory, hide-to-tray on close)
//   tray.js           tray icon + menu, Start with Windows
//   deeplink.js       steamdeals:// links from the website
//   steam-session.js  keeping the Steam store session usable (renewal)
//   library.js        library + taste profile
//   pairing.js        relay client + the shared-basket sync engine (sync.js)
//   site.js           the website the app talks to (pairing, price history, tax region)
//   ipc/*.js          what the UI can ask for (see src/preload.js for the matching API)
//   steam.js, auth.js, settings.js, cache.js   Steam API calls, sign-in, persistence
const { app, BrowserWindow, Menu } = require("electron");
const { registerDeepLinks } = require("./deeplink");
const { onNotificationClick, sync } = require("./pairing");
const { runtime } = require("./runtime");
const { startKeepAlive } = require("./steam-session");
const { linkAccount } = require("./account-sync");
const updates = require("./updates");
const { applyLoginItem, createTray, refreshTray } = require("./tray");
const { createWindow, showWindow } = require("./window");

if (!app.requestSingleInstanceLock()) {
  // Another copy is running; it receives our arguments (and any steamdeals:// link) and comes to the front.
  app.quit();
} else {
  registerDeepLinks(showWindow);
  onNotificationClick(showWindow);
  for (const mod of ["app", "account", "catalog", "cart", "history", "alerts"]) require(`./ipc/${mod}`).register();

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    applyLoginItem();
    setTimeout(() => sync.start(), 3000);
    setTimeout(() => linkAccount(), 4000); // signed in to Steam: join the account's sync channel
    updates.start({ onStatus: refreshTray }); // newer releases from GitHub, offered as "Restart to update"
    setTimeout(startKeepAlive, 15000);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    runtime.quitting = true;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
