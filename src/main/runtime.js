// Process-wide runtime state shared by the main-process modules: the window, the tray icon, and whether
// the app is really quitting (as opposed to hiding to the tray).
const runtime = {
  /** @type {import("electron").BrowserWindow|null} */
  mainWindow: null,
  /** @type {import("electron").Tray|null} */
  tray: null,
  quitting: false,
  /** "Start with Windows" + "Open closed to the tray" launches straight into the tray. */
  startHidden: process.argv.includes("--hidden"),
  /** "Start with Windows" otherwise opens the window filling the screen. */
  startMaximized: process.argv.includes("--maximized"),
};

/** Send an event to the UI, if the window exists. */
function sendToUI(channel, payload) {
  const w = runtime.mainWindow;
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

/** True when the person isn't looking at the window (then notifications are worth showing). */
function windowHidden() {
  const w = runtime.mainWindow;
  return !w || w.isDestroyed() || !w.isVisible() || !w.isFocused();
}

module.exports = { runtime, sendToUI, windowHidden };
