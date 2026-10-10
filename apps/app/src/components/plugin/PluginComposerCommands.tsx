import { pluginCommandId } from "@bb/domain";
import type { PluginComposerApi } from "@get-bb/plugin-sdk";
import { useComposerCommand } from "@/components/promptbox/composer-commands";
import { useComposer } from "@/lib/plugin-sdk-hooks";
import {
  usePluginSlots,
  type PluginCommandPaletteActionSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

type ComposerCommandSlot = Extract<
  PluginCommandPaletteActionSlot,
  { target: "composer" }
>;

export function PluginComposerCommands() {
  const { commandPaletteActions } = usePluginSlots();
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

function runComposerCommand(
  command: ComposerCommandSlot,
  composer: PluginComposerApi,
): void {
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${command.pluginId}] composer command "${command.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  };
  try {
    const result = command.run({ composer });
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

function PluginComposerCommandHandler({
  command,
}: {
  command: ComposerCommandSlot;
}) {
  const composer = useComposer();
  useComposerCommand(pluginCommandId(command.pluginId, command.id), () =>
    runComposerCommand(command, composer),
  );
  return null;
}
