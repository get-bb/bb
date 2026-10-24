import {
  PANE_DIRECTION_APP_COMMAND_IDS,
  keyboardPlatform,
  resolveAppShortcutCommand,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcutInput,
  type KeyboardCommandId,
} from "@bb/domain";

interface ResolveDesktopBrowserAppCommandArgs {
  input: AppShortcutInput;
  platform: string;
  keybindings: AppKeybindings;
  availableCommands?: readonly KeyboardCommandId[];
  splitNavigationEnabled?: boolean;
  splitNavigationCommands?: readonly AppCommandId[];
}

export function resolveDesktopBrowserAppCommand({
  input,
  platform,
  keybindings,
  availableCommands,
  splitNavigationEnabled = false,
  splitNavigationCommands = [],
}: ResolveDesktopBrowserAppCommandArgs): KeyboardCommandId | null {
  const command = resolveAppShortcutCommand({
    input,
    platform,
    isDesktop: true,
    keybindings: keybindings.filter((binding) => {
      if (
        availableCommands === undefined &&
        (binding.command.startsWith("plugin:") ||
          (!binding.when.all.includes("browserFocus") &&
            binding.command !== "panel.previousTab" &&
            binding.command !== "panel.nextTab" &&
            binding.command !== "pane.focus.previous" &&
            binding.command !== "pane.focus.next" &&
            !PANE_DIRECTION_APP_COMMAND_IDS.some(
              (command) => command === binding.command,
            )))
      ) {
        return false;
      }
      if (
        binding.command === "pane.focus.previous" ||
        binding.command === "pane.focus.next"
      ) {
        return splitNavigationEnabled;
      }
      return (
        !PANE_DIRECTION_APP_COMMAND_IDS.some(
          (command) => command === binding.command,
        ) ||
        (splitNavigationEnabled &&
          splitNavigationCommands.some(
            (command) => command === binding.command,
          ))
      );
    }),
    context: {
      mainSurface: true,
      modalOpen: false,
      editableFocus: true,
      terminalFocus: false,
      browserFocus: true,
      modelPickerOpen: false,
      questionOpen: false,
      promptAvailable: false,
      splitActive: splitNavigationEnabled,
      webSurface: false,
      macPlatform: keyboardPlatform(platform) === "mac",
      windowsPlatform: keyboardPlatform(platform) === "windows",
      linuxPlatform: keyboardPlatform(platform) === "linux",
    },
  });
  return command !== null &&
    (availableCommands === undefined || availableCommands.includes(command))
    ? command
    : null;
}
