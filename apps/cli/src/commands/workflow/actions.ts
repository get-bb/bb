import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson } from "../helpers.js";
import {
  mapWorkflowLifecycleError,
  requireWorkflowRunId,
} from "./helpers.js";

interface WorkflowActionCommandOptions {
  json?: boolean;
}

export function registerWorkflowActionsCommands(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("cancel <id>")
    .description(
      "Cancel a workflow run (terminal runs no-op; cancelled runs are never revived)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: WorkflowActionCommandOptions) => {
        const runId = requireWorkflowRunId(id);
        const sdk = createCliBbSdk(getUrl());
        try {
          await sdk.workflows.cancel({ runId });
        } catch (err: unknown) {
          throw mapWorkflowLifecycleError(err, runId);
        }
        if (outputJson(opts, { ok: true, runId })) return;
        console.log(`Workflow run ${runId} cancellation requested.`);
      }),
    );

  parent
    .command("resume <id>")
    .description(
      "Resume an interrupted workflow run (the completed journal prefix replays free)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: WorkflowActionCommandOptions) => {
        const runId = requireWorkflowRunId(id);
        const sdk = createCliBbSdk(getUrl());
        try {
          await sdk.workflows.resume({ runId });
        } catch (err: unknown) {
          throw mapWorkflowLifecycleError(err, runId);
        }
        if (outputJson(opts, { ok: true, runId })) return;
        console.log(
          `Workflow run ${runId} resume requested. Re-attach with 'bb workflow wait ${runId}'.`,
        );
      }),
    );
}
