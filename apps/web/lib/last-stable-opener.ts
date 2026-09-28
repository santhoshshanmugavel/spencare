/**
 * Tracks the last real page element the user interacted with, ignoring
 * anything inside a currently-open Radix popper-positioned overlay
 * (dropdown menu, select, popover, tooltip, hover card, combobox --
 * `[data-radix-popper-content-wrapper]` is the shared wrapper Radix uses
 * for all of them).
 *
 * Exists to fix a focus-restoration bug: when a Dialog/Sheet is opened
 * from a DropdownMenuItem's onSelect, `document.activeElement` at the
 * moment the new Dialog/Sheet's onOpenAutoFocus fires is the menu item
 * itself (it very briefly receives focus as part of Radix's own
 * selection handling), not the dropdown's trigger button. The menu item
 * is unmounted the instant the dropdown closes, so by the time the
 * Dialog/Sheet's onCloseAutoFocus runs, that captured element is gone
 * from the DOM and focus falls back to document.body instead of
 * returning to the "..." button the user actually opened the menu from.
 *
 * The fix: listen for pointerdown/keydown at the document in the capture
 * phase (so this runs before Radix's own handlers), and only record the
 * target when it is NOT inside an open popper overlay. A click on a
 * plain button (the common case) is recorded normally, matching the
 * existing document.activeElement-based behavior exactly. A click on a
 * DropdownMenuItem is inside the wrapper, so it is skipped -- the last
 * recorded element stays the dropdown's own trigger button, captured
 * when the user first clicked it to open the menu.
 */

let lastStableOpener: HTMLElement | null = null;

function isInsideOpenOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-radix-popper-content-wrapper]") !== null;
}

function record(event: Event) {
  const target = event.target;
  if (isInsideOpenOverlay(target)) return;
  if (target instanceof HTMLElement) lastStableOpener = target;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " ") record(event);
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", record, true);
  document.addEventListener("keydown", handleKeydown, true);
}

/** The last real page element interacted with, outside any open overlay. */
export function getLastStableOpener(): HTMLElement | null {
  return lastStableOpener;
}
