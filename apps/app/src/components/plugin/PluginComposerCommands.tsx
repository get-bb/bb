import { pluginCommandId } from "@bb/domain";
import type { ExperimentalComposerActionContext } from "@get-bb/plugin-sdk";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { useBindPluginActionContext } from "@/lib/plugin-action-context-provider";
import { useComposerCommand } from "@/components/promptbox/composer-commands";
import { useComposer } from "@/lib/plugin-sdk-hooks";
import {
  usePluginSlotKind,
  type PluginCommandPaletteActionSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

type ComposerCommandSlot = Extract<
  PluginCommandPaletteActionSlot,
  { target: "composer" }
>;

export function PluginComposerCommands() {
  const commandPaletteActions = usePluginSlotKind("commandPaletteActions");
  return commandPaletteActions.map((command) =>
    command.target === "composer" ? (
      <PluginSlotMount
        key={`${command.pluginId}/${command.id}`}
        pluginId={command.pluginId}
        slotKind="composerCommand"
        slotId={command.id}
        crashFallback={null}
      >
        <PluginComposerCommandHandler command={command} />
      </PluginSlotMount>
    ) : null,
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runComposerCommand(
  command: ComposerCommandSlot,
  context: ExperimentalComposerActionContext,
): void {
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${command.pluginId}] composer command "${command.id}" failed: ${describeError(error)}`,
    );
  };
  try {
    const result = command.run(context);
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

function isComposerCommandAvailable(
  command: ComposerCommandSlot,
  context: ExperimentalComposerActionContext,
): boolean {
  if (
    command.scopes !== undefined &&
    !command.scopes.includes(context.composer.scope.kind)
  ) {
    return false;
  }
  if (command.isAvailable === undefined) return true;
  try {
    return command.isAvailable(context);
  } catch (error) {
    console.warn(
      `[plugin:${command.pluginId}] composer command "${command.id}" isAvailable failed: ${describeError(error)}`,
    );
    return false;
  }
}

function PluginComposerCommandHandler({
  command,
}: {
  command: ComposerCommandSlot;
}) {
  const composer = useComposer();
  const bind = useBindPluginActionContext();
  const host = useAppNavigationHost();
  const context = (): ExperimentalComposerActionContext => ({
    ...bind(command.pluginId, () => host),
    composer,
  });
  useComposerCommand(
    pluginCommandId(command.pluginId, command.id),
    () => runComposerCommand(command, context()),
    () => isComposerCommandAvailable(command, context()),
  );
  return null;
}
