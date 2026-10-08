// The tray icon and its menu, and "Start with Windows".
const { app, Menu, Tray, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const settings = require("./settings");
const { sync } = require("./pairing");
const { runtime, sendToUI } = require("./runtime");
const { showWindow, toggleWindow } = require("./window");
const updates = require("./updates");

const ROOT = path.join(__dirname, "..", "..");

/** Register (or remove) the app as a login item, launching hidden in the tray. Packaged builds only. */
function applyLoginItem() {
  if (!app.isPackaged) return; // a dev run must never register itself to start with Windows
  try {
    const s = settings.get();
    // Start with Windows opens the window maximized; "Open closed to the tray" starts it hidden instead.
    const args = s.startMinimized ? ["--hidden"] : ["--maximized"];
    app.setLoginItemSettings({ openAtLogin: Boolean(s.startWithWindows), path: process.execPath, args });
  } catch {
    /* not fatal */
  }
}

function refreshTray() {
  const tray = runtime.tray;
  if (!tray) return;
  const s = settings.get();
  tray.setToolTip(!s.pairId ? "Steam Deals" : s.syncPaused ? "Steam Deals · syncing paused" : "Steam Deals · basket synced with your other devices");
  // A change made from the tray menu: redraw the menu and tell the UI.
  const changed = () => {
    refreshTray();
    sendToUI("settings:changed", settings.publicView());
  };
  const u = updates.status();
  const updateItem = u.state === "ready" ? { label: `Restart to update to ${u.version}`, click: () => updates.install() }
    : u.state === "downloading" ? { label: `Downloading update ${u.version || ""}… ${u.percent || 0}%`, enabled: false }
    : u.state === "checking" ? { label: "Checking for updates…", enabled: false }
    : { label: "Check for updates", enabled: u.state !== "unavailable", click: () => updates.check() };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Steam Deals", click: showWindow },
    updateItem,
    { type: "separator" },
    {
      label: "Pause syncing with my other devices",
      type: "checkbox",
      checked: Boolean(s.syncPaused),
      enabled: Boolean(s.pairId),
      click: (mi) => {
        settings.update({ syncPaused: mi.checked });
        sync.kick();
        changed();
      },
    },
    {
      label: "Close to tray instead of quitting",
      type: "checkbox",
      checked: s.closeToTray !== false,
      click: (mi) => {
        settings.update({ closeToTray: mi.checked });
        changed();
      },
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: Boolean(s.startWithWindows),
      enabled: app.isPackaged,
      click: (mi) => {
        settings.update({ startWithWindows: mi.checked });
        applyLoginItem();
        changed();
      },
    },
    { type: "separator" },
    {
      label: "Quit Steam Deals",
      click: () => {
        runtime.quitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  const ico = path.join(ROOT, "build", "icon.ico");
  const png = path.join(ROOT, "build", "icon.png");
  const image = fs.existsSync(ico) ? nativeImage.createFromPath(ico) : fs.existsSync(png) ? nativeImage.createFromPath(png).resize({ width: 16, height: 16 }) : null;
  if (!image || image.isEmpty()) return;
  runtime.tray = new Tray(image);
  // A click shows or minimizes the window. (No separate double-click: each of its clicks already toggles.)
  runtime.tray.on("click", toggleWindow);
  refreshTray();
}

module.exports = { createTray, refreshTray, applyLoginItem };
