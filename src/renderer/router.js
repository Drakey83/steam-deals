// Switch between the two screens (sign-in and browse) without the screens importing each other.
const screens = new Map();

export function registerScreen(name, render) {
  screens.set(name, render);
}

export function go(name, ...args) {
  const render = screens.get(name);
  if (!render) throw new Error(`Unknown screen: ${name}`);
  return render(...args);
}
