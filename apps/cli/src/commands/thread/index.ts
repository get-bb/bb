import { Command } from "commander";
import { registerActionsCommands } from "./actions.js";
import { registerInteractionCommands } from "./interactions.js";
import { registerListCommand } from "./list.js";
import { registerOpenCommand } from "./open.js";
import { registerPaneCommand } from "./pane.js";
import { registerOrganizationCommands } from "./organization.js";
import { registerShowCommand } from "./show.js";
import { registerSpawnCommand } from "./spawn.js";
import { registerForkCommand } from "./fork.js";
import { registerRewindCommand } from "./rewind.js";
import { registerWaitCommand } from "./wait.js";

export function registerThreadCommands(
  program: Command,
  getUrl: () => string,
): void {
  const thread = program.command("thread").description("Manage threads");
  registerWaitCommand(thread, getUrl);
  registerSpawnCommand(thread, getUrl);
  registerForkCommand(thread, getUrl);
  registerRewindCommand(thread, getUrl);
  registerListCommand(thread, getUrl);
  registerShowCommand(thread, getUrl);
  registerOpenCommand(thread, getUrl);
  registerPaneCommand(thread, getUrl);
  registerOrganizationCommands(thread, getUrl);
  registerActionsCommands(thread, getUrl);
  registerInteractionCommands(thread, getUrl);
}
