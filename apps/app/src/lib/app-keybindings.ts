import type { AppCommandContext, AppKeybinding, AppShortcut } from "@bb/domain";
import { isMacKeyboardPlatform } from "@bb/domain";

export interface AppShortcutPresentation {
  ariaKeyshortcuts: string;
  label: string;
}

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
  const key =
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;

  if (useMetaForMod) {
    const parts: string[] = [];
    if (showControl) parts.push("⌃");
    if (shortcut.alt) parts.push("⌥");
    if (shortcut.shift) parts.push("⇧");
    if (showMeta) parts.push("⌘");
    parts.push(key);
    return parts.join(" ");
  }

  const parts: string[] = [];
  if (showControl) parts.push("Ctrl");
  if (shortcut.alt) parts.push("Alt");
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
  const parts: string[] = [];
  if (shortcut.control || (shortcut.mod && !useMetaForMod)) {
    parts.push("Control");
  }
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.meta || (shortcut.mod && useMetaForMod)) parts.push("Meta");
  parts.push(
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  );
  return parts.join("+");
}
