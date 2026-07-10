import {
  matchesAppShortcut,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcutInput,
} from "@bb/domain";

interface ResolveDesktopBrowserAppCommandArgs {
  input: AppShortcutInput;
  isMac: boolean;
  keybindings: AppKeybindings;
}

export function resolveDesktopBrowserAppCommand({
  input,
  isMac,
  keybindings,
}: ResolveDesktopBrowserAppCommandArgs): AppCommandId | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding || !binding.when.all.includes("browserFocus")) continue;
    if (matchesAppShortcut(input, binding.shortcut, isMac)) {
      return binding.command;
    }
  }
  return null;
}
