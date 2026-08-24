import type { AppCommandId } from "@bb/domain";
import { APP_COMMAND_GROUPS } from "@/lib/app-command-metadata";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import type { PaletteAction } from "./palette-action";

/** Every command the palette may list, in the order it lists them. */
export const PALETTE_COMMAND_IDS: readonly AppCommandId[] =
  APP_COMMAND_GROUPS.flatMap((group) =>
    group.commands
      .filter((metadata) => metadata.paletteVisible)
      .map((metadata) => metadata.command),
  );

export function paletteActionIdForCommand(command: AppCommandId): string {
  return `app:${command}`;
}

export interface BuildAppCommandActionsArgs {
  /** The element focused before the palette opened, not its own input. */
  target: EventTarget | null;
  isCommandAvailable: (
    command: AppCommandId,
    target: EventTarget | null,
  ) => boolean;
  dispatch: (command: AppCommandId, target: EventTarget | null) => void;
  shortcuts: ReadonlyMap<AppCommandId, AppShortcutPresentation>;
}

/**
 * The app commands that apply right now, in `APP_COMMAND_GROUPS` order. Called
 * once per open, not per keystroke, so rows cannot move under the selection.
 */
export function buildAppCommandActions(
  args: BuildAppCommandActionsArgs,
): PaletteAction[] {
  const actions: PaletteAction[] = [];
  for (const group of APP_COMMAND_GROUPS) {
    for (const metadata of group.commands) {
      if (!metadata.paletteVisible) continue;
      const command = metadata.command;
      if (!args.isCommandAvailable(command, args.target)) continue;
      actions.push({
        id: paletteActionIdForCommand(command),
        group: group.label,
        title: metadata.label,
        shortcut: args.shortcuts.get(command) ?? null,
        run: () => args.dispatch(command, args.target),
      });
    }
  }
  return actions;
}
