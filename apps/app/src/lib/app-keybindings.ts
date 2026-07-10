import type {
  AppCommandContext,
  AppKeybinding,
  AppShortcut,
} from "@bb/domain";

export interface AppShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const SHIFTED_KEY_BASES: Readonly<Record<string, string>> = {
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
};

function normalizeEventKey(event: AppShortcutEvent): string {
  return event.shiftKey ? (SHIFTED_KEY_BASES[event.key] ?? event.key) : event.key;
}

export function isMacKeyboardPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(platform);
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
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

export function matchesAppShortcut(
  event: AppShortcutEvent,
  shortcut: AppShortcut,
  platform: string,
): boolean {
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const expectedMeta = shortcut.meta || (shortcut.mod && useMetaForMod);
  const expectedControl = shortcut.control || (shortcut.mod && !useMetaForMod);
  return (
    normalizeEventKey(event).toLowerCase() === shortcut.key.toLowerCase() &&
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedControl &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift
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
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;

  if (useMetaForMod) {
    return `${showControl ? "⌃" : ""}${shortcut.alt ? "⌥" : ""}${shortcut.shift ? "⇧" : ""}${showMeta ? "⌘" : ""}${key}`;
  }

  const parts: string[] = [];
  if (showControl) parts.push("Ctrl");
  if (shortcut.alt) parts.push("Alt");
  if (shortcut.shift) parts.push("Shift");
  if (showMeta) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}
