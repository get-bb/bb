import { Command } from "commander";
import { registerActionsCommands } from "./actions.js";
import { registerInteractionCommands } from "./interactions.js";
import { registerListCommand } from "./list.js";
import { registerOpenCommand } from "./open.js";
import { registerShowCommand } from "./show.js";
import { registerSpawnCommand } from "./spawn.js";
import { registerTerminalCommands } from "./terminals.js";
import { registerWaitCommand } from "./wait.js";

export { statusText } from "./helpers.js";

export function registerThreadCommands(
  program: Command,
  getUrl: () => string,
): void {
  const thread = program.command("thread").description("Manage threads");
  registerWaitCommand(thread, getUrl);
  registerSpawnCommand(thread, getUrl);
  registerListCommand(thread, getUrl);
  registerShowCommand(thread, getUrl);
  registerOpenCommand(thread, getUrl);
  registerActionsCommands(thread, getUrl);
  registerInteractionCommands(thread, getUrl);
  registerTerminalCommands(thread, getUrl);
}
