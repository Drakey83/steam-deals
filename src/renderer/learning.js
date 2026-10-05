// Recording what the person does in the app, for the For-you ranking (the maths is in logic/behavior.js).
// Events are saved with the settings; the next time the list is ranked they count. Recording never redraws the
// list, so nothing reshuffles while someone is looking at it.
import { newlyOwned, recordEvent } from "./logic/behavior.js";
import { behaviorEvents, patchSettings } from "./state.js";

const save = (events, previous) => {
  if (events !== previous) patchSettings({ behavior: events }, { persistNow: true });
};

/** type: "opened" | "basket" | "dismissed" (see EVENT_WEIGHTS). */
export function learn(type, d) {
  const before = behaviorEvents();
  save(recordEvent(before, type, d), before);
}

/** After the library loads: games opened or basketed here that are now owned count as strong positives. */
export function learnOwned(owned) {
  const before = behaviorEvents();
  save(newlyOwned(before, owned), before);
}

/** "Reset my recommendations": forget everything learned from behaviour (the library profile is untouched). */
export function resetLearning() {
  patchSettings({ behavior: [] }, { persistNow: true });
}
