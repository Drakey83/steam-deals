// Every IPC handler returns an { ok, ... } envelope instead of throwing across the process boundary.
const { ipcMain } = require("electron");

function fail(err) {
  const code = err?.name === "AbortError" ? "cancelled" : err?.code || "error";
  return { ok: false, error: { message: err?.message || String(err), code, status: err?.status ?? null } };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      const data = await fn(payload, event);
      return { ok: true, ...(data && typeof data === "object" ? data : { value: data }) };
    } catch (err) {
      return fail(err);
    }
  });
}

module.exports = { handle, fail };
