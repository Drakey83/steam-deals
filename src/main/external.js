// Opening links outside the app. Only Steam pages and steam:// links are allowed, whatever the UI asks.
const { shell } = require("electron");

const ALLOWED_EXTERNAL = [/^https:\/\/store\.steampowered\.com\//i, /^https:\/\/steamcommunity\.com\//i, /^steam:\/\//i];

function openExternal(url) {
  if (typeof url !== "string" || !ALLOWED_EXTERNAL.some((re) => re.test(url))) return false;
  shell.openExternal(url);
  return true;
}

module.exports = { openExternal };
