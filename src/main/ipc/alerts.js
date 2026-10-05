// Price alerts on the desktop: the UI decides what fired (renderer/logic/alerts.js); this shows the Windows
// notification. Clicking it brings the window back and opens the alerts panel.
const { sendToUI, windowHidden } = require("../runtime");
const { showWindow } = require("../window");
const { handle } = require("./handle");

const MAX_SEPARATE = 3; // more than this at once become one summary notification

function notify(title, body) {
  const { Notification } = require("electron");
  if (!Notification.isSupported()) return false;
  const n = new Notification({ title, body });
  n.on("click", () => {
    showWindow();
    sendToUI("alerts:open");
  });
  n.show();
  return true;
}

/** alerts: [{ name, priceText, targetText }] → shows them (only when the window isn't in front; toasts cover that). */
function showAlerts({ alerts = [] } = {}) {
  const list = alerts.slice(0, 50).filter((a) => a && a.name);
  if (!list.length || !windowHidden()) return { shown: false };
  if (list.length > MAX_SEPARATE) {
    return { shown: notify(`${list.length} games hit your price alerts`, list.map((a) => `${a.name}: ${a.priceText}`).join("\n")) };
  }
  for (const a of list) notify(`${a.name} is ${a.priceText}`, `At or below your ${a.targetText} price alert. Open Steam Deals to add it to your cart.`);
  return { shown: true };
}

function register() {
  handle("alerts:notify", showAlerts);
}

module.exports = { register };
