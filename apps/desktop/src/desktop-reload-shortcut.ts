import {
  isAppKeybindingAvailableForClient,
  keyboardPlatform,
  matchesAppShortcut,
  type AppKeybinding,
  type AppKeybindings,
} from "@bb/domain";

interface DesktopReloadShortcutInput {
  alt: boolean;
  code: string;
  control: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
}

type DesktopReloadShortcut = "reload" | "force-reload";

function macReloadBinding(
  command: "window.reload" | "window.forceReload",
  shift: boolean,
): AppKeybinding {
  return {
    command,
    desktopOnly: true,
    shortcut: {
      key: "r",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift,
    },
    when: { all: ["mainSurface", "macPlatform"], none: ["browserFocus"] },
  };
}

export const STARTUP_RELOAD_KEYBINDINGS: AppKeybindings = [
  macReloadBinding("window.reload", false),
  macReloadBinding("window.forceReload", true),
];

export function resolveDesktopReloadShortcut(
  input: DesktopReloadShortcutInput,
  keybindings: AppKeybindings,
  platform: string,
): DesktopReloadShortcut | null {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) {
    return null;
  }
  const shortcutInput = {
    altKey: input.alt,
    code: input.code,
    ctrlKey: input.control,
    key: input.key,
    metaKey: input.meta,
    shiftKey: input.shift,
  };
  const isMac = keyboardPlatform(platform) === "mac";
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (
      binding === undefined ||
      (binding.command !== "window.reload" &&
        binding.command !== "window.forceReload") ||
      !isAppKeybindingAvailableForClient(binding, { isDesktop: true, platform })
    ) {
      continue;
    }
    if (matchesAppShortcut(shortcutInput, binding.shortcut, isMac)) {
      return binding.command === "window.reload" ? "reload" : "force-reload";
    }
  }
  return null;
}
