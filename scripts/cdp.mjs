// Dev helper: drive the running app over the Chrome DevTools Protocol.
//   node scripts/cdp.mjs shot out.png              screenshot the app window
//   node scripts/cdp.mjs eval "document.title"      evaluate JS in the renderer, print result
//   node scripts/cdp.mjs logs 4000                  collect console/exception events for N ms
// Requires the app started with --remote-debugging-port=9222.
const PORT = process.env.CDP_PORT || 9222;
const [cmd, ...rest] = process.argv.slice(2);

async function target() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url)) || list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target: " + JSON.stringify(list.map((t) => t.url)));
  return page;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onopen = () => resolve({ send, on, close: () => ws.close() });
    ws.onerror = (e) => reject(new Error("ws error"));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) for (const l of listeners) l(msg);
    };
    function send(method, params = {}) {
      return new Promise((res, rej) => {
        pending.set(++id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
    function on(fn) {
      listeners.push(fn);
    }
  });
}

const page = await target();
const c = await connect(page.webSocketDebuggerUrl);

if (cmd === "shot") {
  const out = rest[0] || "shot.png";
  const { data } = await c.send("Page.captureScreenshot", { format: "png" });
  const fs = await import("node:fs");
  fs.writeFileSync(out, Buffer.from(data, "base64"));
  console.log("wrote", out);
} else if (cmd === "eval") {
  const r = await c.send("Runtime.evaluate", { expression: rest.join(" "), awaitPromise: true, returnByValue: true });
  console.log(r.exceptionDetails ? "EXCEPTION: " + JSON.stringify(r.exceptionDetails, null, 1) : JSON.stringify(r.result.value, null, 1));
} else if (cmd === "reload") {
  await c.send("Page.reload", { ignoreCache: true });
  console.log("reloaded (cache ignored)");
} else if (cmd === "ua") {
  // node scripts/cdp.mjs ua "<user agent>" <width> <height> [mobile]
  await c.send("Network.setUserAgentOverride", { userAgent: rest[0] });
  if (rest[1]) await c.send("Emulation.setDeviceMetricsOverride", { width: Number(rest[1]), height: Number(rest[2] || 800), deviceScaleFactor: 2, mobile: rest[3] === "mobile" });
  console.log("user agent + metrics overridden; reload to apply");
} else if (cmd === "logs") {
  const ms = Number(rest[0] || 3000);
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  c.on((m) => {
    if (m.method === "Runtime.consoleAPICalled") console.log(`[console.${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") console.log("[exception]", m.params.exceptionDetails.text, m.params.exceptionDetails.exception?.description);
    if (m.method === "Log.entryAdded") console.log(`[log.${m.params.entry.level}]`, m.params.entry.text, m.params.entry.url || "");
  });
  await new Promise((r) => setTimeout(r, ms));
} else {
  console.log("usage: shot <file> | eval <js> | logs <ms>");
}
c.close();
