import {
  APP_COMMAND_IDS,
  QUESTION_SELECT_APP_COMMAND_IDS,
  isAppKeybindingAvailableForClient,
  isMacKeyboardPlatform,
  normalizeAppShortcutInputKey,
  type AppCommandId,
  type AppDefaultKeybindings,
  type AppKeybindingOverrides,
  type AppShortcut,
  type AppShortcutInput,
} from "@bb/domain";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "OS", "Shift"]);
const QUESTION_COMMANDS = new Set<AppCommandId>(
  QUESTION_SELECT_APP_COMMAND_IDS,
);

export function appShortcutFromInput(
  input: AppShortcutInput,
  platform: string,
): AppShortcut | null {
  if (
    MODIFIER_KEYS.has(input.key) ||
    input.key === "Dead" ||
    input.key === "Unidentified"
  ) {
    return null;
  }
  const normalizedKey = normalizeAppShortcutInputKey(input);
  if (normalizedKey.length === 0 || normalizedKey.length > 32) {
    return null;
  }
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const mod = useMetaForMod ? input.metaKey : input.ctrlKey;
  return {
    key:
      normalizedKey.length === 1 ? normalizedKey.toLowerCase() : normalizedKey,
    mod,
    meta: input.metaKey && !(mod && useMetaForMod),
    control: input.ctrlKey && !(mod && !useMetaForMod),
    alt: input.altKey,
    shift: input.shiftKey,
  };
}

export function areAppShortcutsEqual(
  left: AppShortcut,
  right: AppShortcut,
): boolean {
  return (
    left.key.toLowerCase() === right.key.toLowerCase() &&
    left.mod === right.mod &&
    left.meta === right.meta &&
    left.control === right.control &&
    left.alt === right.alt &&
    left.shift === right.shift
  );
}

export function canAssignAppShortcut(
  command: AppCommandId,
  shortcut: AppShortcut,
): boolean {
  return (
    shortcut.mod ||
    shortcut.meta ||
    shortcut.control ||
    shortcut.alt ||
    /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(shortcut.key) ||
    QUESTION_COMMANDS.has(command)
  );
}

export function getCommandShortcut(
  defaults: AppDefaultKeybindings,
  overrides: AppKeybindingOverrides,
  command: AppCommandId,
  isDesktop: boolean,
  platform: string,
): AppShortcut | null {
  const isMac = isMacKeyboardPlatform(platform);
  let defaultShortcut: AppShortcut | null = null;
  let available = false;
  for (let index = defaults.length - 1; index >= 0; index -= 1) {
    const binding = defaults[index];
    if (
      binding?.command === command &&
      isAppKeybindingAvailableForClient(binding, { isDesktop, isMac })
    ) {
      available = true;
      defaultShortcut = binding.shortcut;
      break;
    }
  }
  if (!available) return null;
  const override = overrides.find((candidate) => candidate.command === command);
  return override === undefined ? defaultShortcut : override.shortcut;
}

export function isAppCommandAvailableForClient(
  defaults: AppDefaultKeybindings,
  command: AppCommandId,
  isDesktop: boolean,
  platform: string,
): boolean {
  const isMac = isMacKeyboardPlatform(platform);
  return defaults.some(
    (binding) =>
      binding.command === command &&
      isAppKeybindingAvailableForClient(binding, { isDesktop, isMac }),
  );
}

export function setCommandShortcutOverride(
  defaults: AppDefaultKeybindings,
  overrides: AppKeybindingOverrides,
  command: AppCommandId,
  shortcut: AppShortcut | null,
  isDesktop: boolean,
  platform: string,
): AppKeybindingOverrides {
  const defaultShortcut = getCommandShortcut(
    defaults,
    [],
    command,
    isDesktop,
    platform,
  );
  const shouldUseDefault =
    shortcut !== null &&
    defaultShortcut !== null &&
    areAppShortcutsEqual(shortcut, defaultShortcut);
  const byCommand = new Map(
    overrides.map((override) => [override.command, override.shortcut]),
  );
  if (shouldUseDefault) {
    byCommand.delete(command);
  } else {
    byCommand.set(command, shortcut);
  }
  return APP_COMMAND_IDS.flatMap((candidate) => {
    if (!byCommand.has(candidate)) return [];
    return [{ command: candidate, shortcut: byCommand.get(candidate) ?? null }];
  });
}

export function resetCommandShortcutOverride(
  overrides: AppKeybindingOverrides,
  command: AppCommandId,
): AppKeybindingOverrides {
  return overrides.filter((override) => override.command !== command);
}

export function getShortcutConflicts(
  defaults: AppDefaultKeybindings,
  overrides: AppKeybindingOverrides,
  command: AppCommandId,
  isDesktop: boolean,
  platform: string,
): AppCommandId[] {
  const shortcut = getCommandShortcut(
    defaults,
    overrides,
    command,
    isDesktop,
    platform,
  );
  if (shortcut === null) return [];
  return APP_COMMAND_IDS.filter((candidate) => {
    if (candidate === command) return false;
    const candidateShortcut = getCommandShortcut(
      defaults,
      overrides,
      candidate,
      isDesktop,
      platform,
    );
    return (
      candidateShortcut !== null &&
      areAppShortcutsEqual(shortcut, candidateShortcut)
    );
  });
}
