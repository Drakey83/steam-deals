// Updating the Windows app from inside it. The latest release on GitHub (Drakey83/steam-deals) is checked a minute
// after launch and every six hours, or whenever the person asks. A newer version downloads quietly in the
// background (electron-updater verifies it against the release's checksum); then the app offers "Restart to
// update", which installs it silently and opens the new version. If the person quits instead, it installs then.
//
// State, sent to the interface as "updates:status" and shown in Settings and the tray menu:
//   { state: "idle" | "checking" | "current" | "downloading" | "ready" | "error" | "unavailable",
//     current, version?, percent?, error?, checkedAt? }
const { app } = require("electron");
const { runtime, sendToUI } = require("./runtime");

const FIRST_CHECK_MS = 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let updater = null;
let status = { state: "idle", current: app.getVersion() };
let onChange = () => {};

function set(next) {
  status = { ...status, ...next, current: app.getVersion() };
  sendToUI("updates:status", status);
  onChange(status);
}

function setup() {
  if (!app.isPackaged) {
    status = { state: "unavailable", current: app.getVersion(), error: "Updates are checked in the installed app." };
    return;
  }
  ({ autoUpdater: updater } = require("electron-updater"));
  updater.autoDownload = true; // quietly, in the background
  updater.autoInstallOnAppQuit = true; // quitting from the tray installs a downloaded update
  updater.logger = null;
  updater.on("checking-for-update", () => set({ state: "checking", error: null }));
  updater.on("update-not-available", () => set({ state: "current", version: null, checkedAt: Date.now() }));
  updater.on("update-available", (info) => set({ state: "downloading", version: info.version, percent: 0, checkedAt: Date.now() }));
  updater.on("download-progress", (p) => set({ state: "downloading", percent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", (info) => set({ state: "ready", version: info.version, percent: 100 }));
  updater.on("error", (err) => set({ state: "error", error: friendly(err) }));
}

/** Errors in words a person can act on. */
function friendly(err) {
  const m = String(err?.message || err || "");
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|network/i.test(m)) return "Couldn't reach GitHub to check for updates. Check your connection and try again.";
  if (/latest\.yml|404/i.test(m)) return "The newest release can't be installed from inside the app. Download it from the website instead.";
  return "Couldn't check for updates right now. Try again in a little while.";
}

async function check() {
  if (!updater) return status;
  if (status.state === "downloading" || status.state === "ready") return status; // already on its way
  try {
    await updater.checkForUpdates();
  } catch (err) {
    set({ state: "error", error: friendly(err) });
  }
  return status;
}

/** Restart into the downloaded version (installed silently, then reopened). */
function install() {
  if (!updater || status.state !== "ready") return false;
  runtime.quitting = true; // the window's close handler would otherwise just hide it to the tray
  setImmediate(() => updater.quitAndInstall(true, true));
  return true;
}

function start({ onStatus } = {}) {
  if (onStatus) onChange = onStatus;
  setup();
  if (!updater) return;
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, EVERY_MS);
}

module.exports = { start, check, install, status: () => status };
