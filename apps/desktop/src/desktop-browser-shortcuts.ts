import {
  PANE_DIRECTION_APP_COMMAND_IDS,
  appCommandIdSchema,
  matchesAppShortcut,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcutInput,
} from "@bb/domain";

interface ResolveDesktopBrowserAppCommandArgs {
  input: AppShortcutInput;
  isMac: boolean;
  keybindings: AppKeybindings;
  splitNavigationEnabled?: boolean;
  splitNavigationCommands?: readonly AppCommandId[];
}

export function resolveDesktopBrowserAppCommand({
  input,
  isMac,
  keybindings,
  splitNavigationEnabled = false,
  splitNavigationCommands = [],
}: ResolveDesktopBrowserAppCommandArgs): AppCommandId | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (
      !binding ||
      (!binding.when.all.includes("browserFocus") &&
        binding.command !== "panel.previousTab" &&
        binding.command !== "panel.nextTab" &&
        binding.command !== "pane.focus.previous" &&
        binding.command !== "pane.focus.next" &&
        !PANE_DIRECTION_APP_COMMAND_IDS.some(
          (command) => command === binding.command,
        ))
    )
      continue;
    if (
      !splitNavigationEnabled &&
      (binding.command === "pane.focus.previous" ||
        binding.command === "pane.focus.next")
    ) {
      continue;
    }
    if (
      PANE_DIRECTION_APP_COMMAND_IDS.some(
        (command) => command === binding.command,
      ) &&
      (!splitNavigationEnabled ||
        !splitNavigationCommands.some((command) => command === binding.command))
    )
      continue;
    if (matchesAppShortcut(input, binding.shortcut, isMac)) {
      const command = appCommandIdSchema.safeParse(binding.command);
      if (command.success) return command.data;
    }
  }
  return null;
}
