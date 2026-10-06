// Editing "Your taste" by hand: drag a tag from the sidebar's Tags onto Your taste to add it, drag one of your
// taste's tags back onto Tags (or click its ×) to remove it, restore removed ones, or type a tag to add it
// (phones and keyboards can't drag). The rules live in logic/taste.js; saving goes through settings.tasteTags.
import { el } from "../lib/dom.js";
import { addTasteTag, normalizeTasteEdits, removeTasteTag, restoreTasteTag } from "../logic/taste.js";
import { patchSettings, state, tagName, tasteEdits, tasteModel } from "../state.js";
import { toast } from "../ui/toast.js";

// Where a dragged tag came from, as its own data type: during dragover only the types are readable.
const FROM_SIDEBAR = "application/x-steamdeals-tag-sidebar";
const FROM_TASTE = "application/x-steamdeals-tag-taste";

export const TASTE_HELP =
  "Your taste is the set of tags For you ranks by. It's learned from your library and playtime, and you can change it:\n" +
  "• Add a tag: drag it from Tags (left) onto this panel, or type it in “Add a tag”.\n" +
  "• Remove a tag: drag it onto Tags, or click its ×. Removed tags stop lifting games, and stay out after a rebuild.\n" +
  "• Changed your mind: click a removed tag to restore it, or Reset to go back to what was learned.";

export const SIDEBAR_TAG_HINT = "Drag onto Your taste (in For you) to add it to your taste.";

function save(next, message, undoTo) {
  patchSettings({ tasteTags: next }, { persistNow: true });
  toast(message, { type: "ok", action: () => patchSettings({ tasteTags: undoTo }, { persistNow: true }), actionLabel: "Undo", timeout: 6000 });
}

export function addToTaste(id) {
  const before = normalizeTasteEdits(tasteEdits());
  if (tasteModel()?.topTags.includes(id)) return toast(`${tagName(id)} is already in your taste.`);
  save(addTasteTag(before, id), `Added ${tagName(id)} to your taste. For you now ranks games with it higher.`, before);
}

export function removeFromTaste(id) {
  const before = normalizeTasteEdits(tasteEdits());
  const learned = Boolean(tasteModel()?.learnedTags.includes(id));
  save(removeTasteTag(before, id, learned), `Removed ${tagName(id)} from your taste.`, before);
}

export function restoreToTaste(id) {
  const before = normalizeTasteEdits(tasteEdits());
  save(restoreTasteTag(before, id), `${tagName(id)} is back in your taste.`, before);
}

export function resetTasteEdits() {
  const before = normalizeTasteEdits(tasteEdits());
  save({ added: [], removed: [] }, "Your taste is back to what was learned from your library.", before);
}

/** Make `node` (a tag chip) draggable as tag `id` from `from` ("sidebar" | "taste"). */
export function dragTag(node, id, from) {
  node.draggable = true;
  node.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(from === "taste" ? FROM_TASTE : FROM_SIDEBAR, String(id));
    e.dataTransfer.setData("text/plain", tagName(id));
    document.body.classList.add(from === "taste" ? "dragging-taste-tag" : "dragging-sidebar-tag");
  });
  node.addEventListener("dragend", () => document.body.classList.remove("dragging-taste-tag", "dragging-sidebar-tag"));
  return node;
}

/** Make `zone` accept tags dragged from `from`, calling onDrop(tagId). Highlights while a tag is over it. */
export function tagDropZone(zone, from, onDrop) {
  const type = from === "taste" ? FROM_TASTE : FROM_SIDEBAR;
  const accepts = (e) => [...(e.dataTransfer?.types || [])].includes(type);
  let depth = 0;
  zone.addEventListener("dragenter", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth++;
    zone.classList.add("drop-over");
  });
  zone.addEventListener("dragover", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  zone.addEventListener("dragleave", (e) => {
    if (!accepts(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove("drop-over");
  });
  zone.addEventListener("drop", (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth = 0;
    zone.classList.remove("drop-over");
    document.body.classList.remove("dragging-taste-tag", "dragging-sidebar-tag");
    const id = Number(e.dataTransfer.getData(type));
    if (Number.isInteger(id) && id > 0) onDrop(id);
  });
  return zone;
}

/** "Add a tag" box: type a tag's name (suggestions from every known tag) and press Enter. */
export function addTagInput() {
  const listId = "taste-tag-options";
  const names = new Map(Object.entries(state.tags || {}).map(([id, name]) => [String(name).toLowerCase(), Number(id)]));
  const list = el("datalist", { id: listId }, [...names.keys()].sort().map((n) => el("option", { value: state.tags[names.get(n)] })));
  const input = el("input", { class: "input fy-add", type: "text", placeholder: "Add a tag…", "aria-label": "Add a tag to your taste", title: "Type a tag's name and press Enter to add it to your taste", list: listId, autocomplete: "off", spellcheck: "false" });
  const submit = () => {
    const id = names.get(input.value.trim().toLowerCase());
    if (!id) return input.value.trim() && toast(`No tag called “${input.value.trim()}”. Pick one from the suggestions.`, { type: "err" });
    input.value = "";
    addToTaste(id);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  input.addEventListener("change", () => names.has(input.value.trim().toLowerCase()) && submit()); // picked a suggestion
  return el("span", { class: "fy-add-wrap" }, input, list);
}
