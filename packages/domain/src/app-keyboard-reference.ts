import { APP_COMMAND_GROUPS } from "./app-command-metadata.js";
import { DEFAULT_APP_KEYBINDINGS } from "./app-default-keybindings.js";
import {
  isMacKeyboardPlatform,
  type AppCommandId,
  type AppDefaultKeybinding,
  type AppShortcut,
} from "./app-keybindings.js";

const SHORTCUT_KEY_GLYPHS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export function formatAppShortcut(
  shortcut: AppShortcut,
  platform: string,
): string {
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const showMeta = shortcut.meta || (shortcut.mod && useMetaForMod);
  const showControl = shortcut.control || (shortcut.mod && !useMetaForMod);
  const key =
    shortcut.key.length === 1
      ? shortcut.key.toUpperCase()
      : (SHORTCUT_KEY_GLYPHS[shortcut.key] ?? shortcut.key);

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

type AppShortcutSurface = "everywhere" | "desktop app" | "browser";

export interface AppShortcutReferenceKey {
  keys: string;
  surface: AppShortcutSurface;
}

interface AppShortcutReferenceRow {
  command: AppCommandId;
  label: string;
  description: string;
  mac: AppShortcutReferenceKey[];
  windowsLinux: AppShortcutReferenceKey[];
}

interface AppShortcutReferenceGroup {
  label: string;
  rows: AppShortcutReferenceRow[];
}

function bindingSurface(binding: AppDefaultKeybinding): AppShortcutSurface {
  if (binding.desktopOnly || binding.when.none.includes("webSurface")) {
    return "desktop app";
  }
  return binding.when.all.includes("webSurface") ? "browser" : "everywhere";
}

function appliesToMac(binding: AppDefaultKeybinding): boolean {
  return (
    !binding.when.none.includes("macPlatform") &&
    !binding.when.all.includes("windowsPlatform") &&
    !binding.when.all.includes("linuxPlatform")
  );
}

function appliesToWindowsLinux(binding: AppDefaultKeybinding): boolean {
  return !binding.when.all.includes("macPlatform");
}

function referenceKeys(
  bindings: readonly AppDefaultKeybinding[],
  applies: (binding: AppDefaultKeybinding) => boolean,
  platform: string,
): AppShortcutReferenceKey[] {
  const keys: AppShortcutReferenceKey[] = [];
  for (const binding of bindings) {
    if (binding.shortcut === null || !applies(binding)) continue;
    const key = {
      keys: formatAppShortcut(binding.shortcut, platform),
      surface: bindingSurface(binding),
    };
    if (
      !keys.some(
        (existing) =>
          existing.keys === key.keys && existing.surface === key.surface,
      )
    ) {
      keys.push(key);
    }
  }
  return keys;
}

export function appKeyboardShortcutReference(): AppShortcutReferenceGroup[] {
  return APP_COMMAND_GROUPS.map((group) => ({
    label: group.label,
    rows: group.commands.map((metadata) => {
      const bindings = DEFAULT_APP_KEYBINDINGS.filter(
        (binding) => binding.command === metadata.command,
      );
      return {
        command: metadata.command,
        label: metadata.label,
        description: metadata.description,
        mac: referenceKeys(bindings, appliesToMac, "Mac"),
        windowsLinux: referenceKeys(bindings, appliesToWindowsLinux, "Linux"),
      };
    }),
  }));
}
