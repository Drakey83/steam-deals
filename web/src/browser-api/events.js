// Callbacks the UI registers (progress, streamed pages, shared-basket updates).
const listeners = {};

export function on(name, cb) {
  (listeners[name] ||= new Set()).add(cb);
  return () => listeners[name].delete(cb);
}

export function emit(name, data) {
  listeners[name]?.forEach((cb) => cb(data));
}
