import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  DEFAULT_WORKFLOW_WAIT_POLL_INTERVAL_MS,
  DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS,
  parseWorkflowWaitPollIntervalMs,
  parseWorkflowWaitTimeoutSeconds,
  reportSettledWorkflowRun,
  requireWorkflowRunId,
  waitForSettledWorkflowRun,
} from "./helpers.js";

interface WorkflowWaitCommandOptions {
  timeout?: string;
  pollInterval?: string;
  json?: boolean;
}

export function registerWorkflowWaitCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("wait <id>")
    .description(
      "Wait for a workflow run to settle and print its result (exits 0 only when it completes)",
    )
    .option(
      "--timeout <seconds>",
      `Timeout in seconds (default: ${DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS})`,
    )
    .option(
      "--poll-interval <ms>",
      `Polling interval in milliseconds between long-poll rounds (default: ${DEFAULT_WORKFLOW_WAIT_POLL_INTERVAL_MS})`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: WorkflowWaitCommandOptions) => {
        const runId = requireWorkflowRunId(id);
        const sdk = createCliBbSdk(getUrl());
        const run = await waitForSettledWorkflowRun({
          sdk,
          runId,
          timeoutSeconds: parseWorkflowWaitTimeoutSeconds(opts.timeout),
          pollIntervalMs: parseWorkflowWaitPollIntervalMs(opts.pollInterval),
        });
        reportSettledWorkflowRun(opts, run);
      }),
    );
}
