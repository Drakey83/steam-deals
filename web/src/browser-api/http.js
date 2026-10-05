// Calling the site's own /api functions, and the { ok, ... } envelope the UI expects
// (the same shape the desktop app's IPC handlers return).

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code || "error";
    this.status = status ?? null;
  }
}

export async function http(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("You appear to be offline, or the site couldn't be reached.", "network");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new ApiError(data?.error?.message || `The server answered HTTP ${res.status}.`, data?.error?.code, res.status);
  return data;
}

export const ok = (data) => ({ ok: true, ...(data && typeof data === "object" ? data : { value: data }) });

export const fail = (err) => ({
  ok: false,
  error: { message: err?.message || String(err), code: err?.name === "AbortError" ? "cancelled" : err?.code || "error", status: err?.status ?? null },
});

/** Wrap an async function so it returns the envelope instead of throwing. */
export const wrap = (fn) => async (arg) => {
  try {
    return ok(await fn(arg));
  } catch (err) {
    return fail(err);
  }
};
