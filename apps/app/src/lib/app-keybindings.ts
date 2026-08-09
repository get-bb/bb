import type { AppCommandContext, AppKeybinding, AppShortcut } from "@bb/domain";
import { isMacKeyboardPlatform } from "@bb/domain";

export interface AppShortcutPresentation {
  ariaKeyshortcuts: string;
  label: string;
}

const NATIVE_EDITING_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return (
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/**
 * Navigation and deletion keys keep their native editable-control behavior
 * regardless of modifiers. This covers each platform's character, word,
 * line, and document movement/selection chords without tying arbitration to
 * any configurable app shortcut.
 */
export function isNativeEditableKeyEvent(event: KeyboardEvent): boolean {
  return (
    isEditableKeyboardTarget(event.target) && NATIVE_EDITING_KEYS.has(event.key)
  );
}

export function matchesAppCommandContext(
  binding: AppKeybinding,
  context: AppCommandContext,
): boolean {
  return (
    binding.when.all.every((key) => context[key]) &&
    binding.when.none.every((key) => !context[key])
  );
}

export function formatAppShortcut(
  shortcut: AppShortcut,
  platform: string,
): string {
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const showMeta = shortcut.meta || (shortcut.mod && useMetaForMod);
  const showControl = shortcut.control || (shortcut.mod && !useMetaForMod);
  const isRightOption = shortcut.key === "AltRight";
  const key = isRightOption
    ? `Right ${useMetaForMod ? "⌥" : "Alt"}`
    : shortcut.key.length === 1
      ? shortcut.key.toUpperCase()
      : shortcut.key;

  if (useMetaForMod) {
    const parts: string[] = [];
    if (showControl) parts.push("⌃");
    if (shortcut.alt && !isRightOption) parts.push("⌥");
    if (shortcut.shift) parts.push("⇧");
    if (showMeta) parts.push("⌘");
    parts.push(key);
    return parts.join(" ");
  }

  const parts: string[] = [];
  if (showControl) parts.push("Ctrl");
  if (shortcut.alt && !isRightOption) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(key);
  return parts.join(" + ");
}

export function formatAppShortcutAria(
  shortcut: AppShortcut,
  platform: string,
): string {
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const isRightOption = shortcut.key === "AltRight";
  const parts: string[] = [];
  if (shortcut.control || (shortcut.mod && !useMetaForMod)) {
    parts.push("Control");
  }
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.meta || (shortcut.mod && useMetaForMod)) parts.push("Meta");
  if (!isRightOption) {
    parts.push(
      shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
    );
  }
  return parts.join("+");
}
