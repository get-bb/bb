import { pluginCommandId, type PluginCommandId } from "@bb/domain";
import type { PluginCommandContext } from "@get-bb/plugin-sdk";
import type { AppPanelController } from "@/lib/app-fixed-tab-navigation";
import {
  createPluginPanelController,
  createRetiredOpenPanel,
} from "@/lib/plugin-panel-controller";
import type { PluginCommandPaletteActionSlot } from "@/lib/plugin-slots";
import { getPluginDisplayName } from "@/lib/plugin-logos";
import type { PaletteAction } from "./palette-action";

type AppCommandSlot = Extract<
  PluginCommandPaletteActionSlot,
  { target: "app" }
>;
type ComposerCommandSlot = Extract<
  PluginCommandPaletteActionSlot,
  { target: "composer" }
>;

export interface BuildPluginPaletteActionsArgs {
  slots: readonly AppCommandSlot[];
  threadId: string | null;
  projectId: string | null;
  panel: AppPanelController | null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function actionContext(
  slot: AppCommandSlot,
  args: BuildPluginPaletteActionsArgs,
): PluginCommandContext {
  const experimental_panel = createPluginPanelController(
    slot.pluginId,
    () => args.panel,
  );
  const context: PluginCommandContext & {
    openPanel: ReturnType<typeof createRetiredOpenPanel>;
  } = {
    threadId: args.threadId,
    projectId: args.projectId,
    experimental_panel,
    openPanel: createRetiredOpenPanel(experimental_panel),
  };
  return context;
}

export function buildPluginPaletteActions(
  args: BuildPluginPaletteActionsArgs,
): PaletteAction[] {
  const actions: PaletteAction[] = [];
  for (const slot of args.slots) {
    const context = actionContext(slot, args);
    if (slot.isAvailable !== undefined) {
      let available: boolean;
      try {
        available = slot.isAvailable(context);
      } catch (error) {
        console.warn(
          `[plugin:${slot.pluginId}] commandPaletteAction "${slot.id}" isAvailable failed: ${describeError(error)}`,
        );
        continue;
      }
      if (!available) continue;
    }
    actions.push({
      id: `plugin:${slot.pluginId}/${slot.id}`,
      bucket: "Plugins",
      group: getPluginDisplayName(slot.pluginId),
      title: slot.title,
      shortcut: null,
      run: () => {
        const warn = (error: unknown) => {
          console.warn(
            `[plugin:${slot.pluginId}] commandPaletteAction "${slot.id}" failed: ${describeError(error)}`,
          );
        };
        try {
          const result = slot.run(context);
          if (result instanceof Promise) result.catch(warn);
        } catch (error) {
          warn(error);
        }
      },
    });
  }
  return actions;
}

export interface BuildPluginComposerCommandActionsArgs {
  slots: readonly ComposerCommandSlot[];
  target: EventTarget | null;
  isCommandAvailable: (
    command: PluginCommandId,
    target: EventTarget | null,
  ) => boolean;
  dispatch: (command: PluginCommandId, target: EventTarget | null) => void;
}

export function buildPluginComposerCommandActions(
  args: BuildPluginComposerCommandActionsArgs,
): PaletteAction[] {
  return args.slots.flatMap((slot) => {
    const command = pluginCommandId(slot.pluginId, slot.id);
    if (!args.isCommandAvailable(command, args.target)) return [];
    return [
      {
        id: command,
        bucket: "Plugins",
        group: getPluginDisplayName(slot.pluginId),
        title: slot.title,
        shortcut: null,
        run: () => args.dispatch(command, args.target),
      },
    ];
  });
}
