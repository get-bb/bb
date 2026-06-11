import { Command } from "commander";
import { registerWorkflowActionsCommands } from "./actions.js";
import { registerWorkflowListCommand } from "./list.js";
import { registerWorkflowRunCommand } from "./run.js";
import { registerWorkflowRunsCommand } from "./runs.js";
import { registerWorkflowSaveCommand } from "./save.js";
import { registerWorkflowShowCommand } from "./show.js";
import { registerWorkflowValidateCommand } from "./validate.js";
import { registerWorkflowWaitCommand } from "./wait.js";

export function registerWorkflowCommands(
  program: Command,
  getUrl: () => string,
): void {
  const workflow = program
    .command("workflow")
    .description("Author and run deterministic multi-agent workflows");
  registerWorkflowListCommand(workflow, getUrl);
  registerWorkflowValidateCommand(workflow);
  registerWorkflowRunCommand(workflow, getUrl);
  registerWorkflowRunsCommand(workflow, getUrl);
  registerWorkflowShowCommand(workflow, getUrl);
  registerWorkflowWaitCommand(workflow, getUrl);
  registerWorkflowActionsCommands(workflow, getUrl);
  registerWorkflowSaveCommand(workflow);
}
