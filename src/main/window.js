// The app window: creation, remembering its size and position, and hiding to the tray on close.
const { BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const settings = require("./settings");
const { openExternal } = require("./external");
const { runtime } = require("./runtime");

const BG = "#0b0f14";
const ROOT = path.join(__dirname, "..", "..");

function createWindow() {
  const b = settings.get().windowBounds || {};
  const iconPath = path.join(ROOT, "build", "icon.png");
  const win = new BrowserWindow({
    width: b.width || 1320,
    height: b.height || 860,
    x: Number.isFinite(b.x) ? b.x : undefined,
    y: Number.isFinite(b.y) ? b.y : undefined,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: BG,
    title: "Steam Deals",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: BG, symbolColor: "#c9d4df", height: 44 },
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false, // keep syncing at full speed while hidden in the tray
    },
  });
  runtime.mainWindow = win;

  if (b.maximized) win.maximize();
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (!runtime.startHidden) win.show();
  });

  rememberBounds(win);
  hideToTrayOnClose(win);
  win.on("closed", () => {
    runtime.mainWindow = null;
  });

  // The UI never navigates; links open outside.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12" || (input.control && input.shift && input.key.toUpperCase() === "I")) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
  return win;
}

function rememberBounds(win) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const maximized = win.isMaximized();
      const bounds = maximized ? settings.get().windowBounds || {} : win.getBounds();
      settings.update({ windowBounds: { ...bounds, maximized } });
    }, 250);
  };
  win.on("resize", save);
  win.on("move", save);
  win.on("maximize", () => {
    save();
    win.webContents.send("window:maximized", true);
  });
  win.on("unmaximize", () => {
    save();
    win.webContents.send("window:maximized", false);
  });
}

// The X button hides the app to the tray, so the basket keeps syncing with the phone. Quit from the tray menu.
function hideToTrayOnClose(win) {
  win.on("close", (e) => {
    if (runtime.quitting || settings.get().closeToTray === false || !runtime.tray) return;
    e.preventDefault();
    win.hide();
    if (settings.get().trayHintShown) return;
    settings.update({ trayHintShown: true });
    try {
      runtime.tray.displayBalloon({
        title: "Steam Deals is still running",
        content: "It keeps your Steam cart in sync with your phone from here. Right-click the icon to quit or change that.",
        iconType: "info",
      });
    } catch {
      /* balloons are optional */
    }
  });
}

function showWindow() {
  const win = runtime.mainWindow;
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

module.exports = { createWindow, showWindow };
