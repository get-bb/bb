import {
  applyAppKeybindingOverrides,
  isAppKeybindingAvailableForClient,
  isMacKeyboardPlatform,
  keyboardPlatform,
  matchesAppShortcut,
  type AppCommandContextKey,
  type AppDefaultKeybinding,
  type AppDefaultKeybindings,
  type AppKeybinding,
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

const FOCUS_SCOPES: readonly AppCommandContextKey[] = [
  "browserFocus",
  "terminalFocus",
];

function contextsExclusive(
  left: AppDefaultKeybinding,
  right: AppKeybinding,
): boolean {
  return (
    left.when.none.some((context) => right.when.all.includes(context)) ||
    left.when.all.some((context) => right.when.none.includes(context))
  );
}

function focusScopesToYield(
  binding: AppDefaultKeybinding,
  candidate: AppKeybinding,
): AppCommandContextKey[] {
  return candidate.when.all.filter(
    (context) =>
      FOCUS_SCOPES.includes(context) && !binding.when.all.includes(context),
  );
}

export function resolvePluginCommandDefaults(
  defaults: AppDefaultKeybindings,
  overrides: AppKeybindingOverrides,
  isDesktop: boolean,
  platform: string,
  bundledCommands: ReadonlySet<KeyboardCommandId>,
): {
  defaults: AppDefaultKeybindings;
  conflicts: ReadonlyMap<KeyboardCommandId, readonly KeyboardCommandId[]>;
} {
  const client = { isDesktop, platform };
  const effective = applyAppKeybindingOverrides(defaults, overrides).filter(
    (binding) => isAppKeybindingAvailableForClient(binding, client),
  );
  const customized = new Set(
    overrides
      .filter(
        (override) =>
          override.platform === undefined ||
          override.platform === keyboardPlatform(platform),
      )
      .map((override) => override.command),
  );
  const conflicts = new Map<KeyboardCommandId, KeyboardCommandId[]>();
  const resolved = defaults.map((binding) => {
    if (
      !binding.command.startsWith("plugin:") ||
      binding.shortcut === null ||
      customized.has(binding.command)
    )
      return binding;
    const shortcut = binding.shortcut;
    const bundled = bundledCommands.has(binding.command);
    const collisions = effective.filter(
      (candidate) =>
        candidate.command !== binding.command &&
        (!bundled ||
          !candidate.command.startsWith("plugin:") ||
          bundledCommands.has(candidate.command)) &&
        shortcutsConflict(shortcut, candidate.shortcut, platform),
    );
    const yielded = new Set<AppCommandContextKey>();
    const blocking = collisions.filter((candidate) => {
      if (contextsExclusive(binding, candidate)) return false;
      const scopes = focusScopesToYield(binding, candidate);
      for (const scope of scopes) yielded.add(scope);
      return scopes.length === 0;
    });
    if (blocking.length === 0) {
      if (yielded.size === 0) return binding;
      return {
        ...binding,
        when: {
          ...binding.when,
          none: [...new Set([...binding.when.none, ...yielded])],
        },
      };
    }
    conflicts.set(binding.command, [
      ...new Set(blocking.map((candidate) => candidate.command)),
    ]);
    return { ...binding, shortcut: null };
  });
  return { defaults: resolved, conflicts };
}
