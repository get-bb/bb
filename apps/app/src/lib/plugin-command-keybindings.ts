import {
  applyAppKeybindingOverrides,
  isAppKeybindingAvailableForClient,
  isMacKeyboardPlatform,
  matchesAppShortcut,
  type AppDefaultKeybindings,
  type AppKeybindingOverrides,
  type AppShortcut,
  type KeyboardCommandId,
} from "@bb/domain";

export function shortcutsConflict(
  left: AppShortcut,
  right: AppShortcut,
  platform: string,
): boolean {
  const isMac = isMacKeyboardPlatform(platform);
  return matchesAppShortcut(
    {
      key: left.key,
      code: "",
      altKey: left.alt,
      ctrlKey: left.control || (left.mod && !isMac),
      metaKey: left.meta || (left.mod && isMac),
      shiftKey: left.shift,
    },
    right,
    isMac,
  );
}

export function resolvePluginCommandDefaults(
  defaults: AppDefaultKeybindings,
  overrides: AppKeybindingOverrides,
  isDesktop: boolean,
  platform: string,
): {
  defaults: AppDefaultKeybindings;
  conflicts: ReadonlyMap<KeyboardCommandId, readonly KeyboardCommandId[]>;
} {
  const client = { isDesktop, isMac: isMacKeyboardPlatform(platform) };
  const effective = applyAppKeybindingOverrides(defaults, overrides).filter(
    (binding) => isAppKeybindingAvailableForClient(binding, client),
  );
  const customized = new Set(overrides.map((override) => override.command));
  const conflicts = new Map<KeyboardCommandId, KeyboardCommandId[]>();
  const resolved = defaults.map((binding) => {
    if (
      !binding.command.startsWith("plugin:") ||
      binding.shortcut === null ||
      customized.has(binding.command)
    )
      return binding;
    const shortcut = binding.shortcut;
    const collisions = effective.filter(
      (candidate) =>
        candidate.command !== binding.command &&
        shortcutsConflict(shortcut, candidate.shortcut, platform),
    );
    if (collisions.length === 0) return binding;
    conflicts.set(binding.command, [
      ...new Set(collisions.map((candidate) => candidate.command)),
    ]);
    return { ...binding, shortcut: null };
  });
  return { defaults: resolved, conflicts };
}
