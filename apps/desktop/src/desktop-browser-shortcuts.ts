import {
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
}

export function resolveDesktopBrowserAppCommand({
  input,
  isMac,
  keybindings,
}: ResolveDesktopBrowserAppCommandArgs): AppCommandId | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (
      !binding ||
      (!binding.when.all.includes("browserFocus") &&
        binding.command !== "panel.previousTab" &&
        binding.command !== "panel.nextTab" &&
        binding.command !== "pane.focus.previous" &&
        binding.command !== "pane.focus.next")
    )
      continue;
    if (matchesAppShortcut(input, binding.shortcut, isMac)) {
      const command = appCommandIdSchema.safeParse(binding.command);
      if (command.success) return command.data;
    }
  }
  return null;
}
