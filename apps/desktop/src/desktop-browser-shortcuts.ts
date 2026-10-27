import {
  PANE_DIRECTION_APP_COMMAND_IDS,
  appCommandIdSchema,
  isAppKeybindingAvailableForClient,
  resolveAppShortcutBinding,
  keyboardPlatform,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcutInput,
} from "@bb/domain";

interface ResolveDesktopBrowserAppCommandArgs {
  input: AppShortcutInput;
  platform: string;
  keybindings: AppKeybindings;
  splitNavigationEnabled?: boolean;
  splitNavigationCommands?: readonly AppCommandId[];
}

export function resolveDesktopBrowserAppCommand({
  input,
  platform,
  keybindings,
  splitNavigationEnabled = false,
  splitNavigationCommands = [],
}: ResolveDesktopBrowserAppCommandArgs): AppCommandId | null {
  const isMac = keyboardPlatform(platform) === "mac";
  const binding = resolveAppShortcutBinding(
    input,
    keybindings,
    isMac,
    (binding) => {
      if (
        !isAppKeybindingAvailableForClient(binding, {
          isDesktop: true,
          platform,
        }) ||
        (!binding.when.all.includes("browserFocus") &&
          binding.command !== "panel.previousTab" &&
          binding.command !== "panel.nextTab" &&
          binding.command !== "pane.focus.previous" &&
          binding.command !== "pane.focus.next" &&
          !PANE_DIRECTION_APP_COMMAND_IDS.some(
            (command) => command === binding.command,
          ))
      )
        return false;
      if (
        !splitNavigationEnabled &&
        (binding.command === "pane.focus.previous" ||
          binding.command === "pane.focus.next")
      ) {
        return false;
      }
      if (
        PANE_DIRECTION_APP_COMMAND_IDS.some(
          (command) => command === binding.command,
        ) &&
        (!splitNavigationEnabled ||
          !splitNavigationCommands.some(
            (command) => command === binding.command,
          ))
      )
        return false;
      return appCommandIdSchema.safeParse(binding.command).success;
    },
  );
  const command = appCommandIdSchema.safeParse(binding?.command);
  return command.success ? command.data : null;
}
