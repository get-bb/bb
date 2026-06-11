import { Command } from "commander";
import type { WorkflowRunResponse } from "@bb/server-contract";
import { workflowRunDisplayState } from "@bb/thread-view";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson } from "../helpers.js";
import {
  formatDurationMs,
  formatWorkflowAgentProgress,
  formatWorkflowProgressTreeLines,
  formatWorkflowRunStatus,
  requireWorkflowRunId,
  workflowRunDeepLink,
} from "./helpers.js";

interface WorkflowShowCommandOptions {
  json?: boolean;
}

export function registerWorkflowShowCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("show <id>")
    .description(
      "Show a workflow run: status, resolved defaults, usage, and the phase/agent tree",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: WorkflowShowCommandOptions) => {
        const runId = requireWorkflowRunId(id);
        const sdk = createCliBbSdk(getUrl());
        const run = await sdk.workflows.get({ runId });
        if (outputJson(opts, run)) return;
        printWorkflowRun(run, getUrl());
      }),
    );
}

function printWorkflowRun(run: WorkflowRunResponse, serverUrl: string): void {
  console.log(`Run: ${run.id}`);
  console.log(`  Workflow: ${run.workflowName} (${run.sourceTier} tier)`);
  const progress = formatWorkflowAgentProgress(run.progressSnapshot);
  console.log(
    `  Status: ${formatWorkflowRunStatus(run.status)}${progress === "-" ? "" : ` (${progress} agents settled)`}`,
  );
  if (run.failureReason !== null) {
    console.log(`  Failure: ${run.failureReason}`);
  }
  console.log(`  Project: ${run.projectId}`);
  console.log(`  Host: ${run.hostId}`);
  console.log(`  Workspace: ${run.workspacePath}`);
  if (run.anchorThreadId !== null) {
    console.log(`  Anchor thread: ${run.anchorThreadId}`);
  }
  console.log(
    `  Provider: ${run.providerId}${run.model !== null ? ` (${run.model})` : ""}, effort ${run.effort}`,
  );
  console.log(`  Sandbox: ${run.sandbox}`);
  console.log(
    `  Caps: concurrency ${run.concurrency}, maxAgents ${run.maxAgents}, maxFanout ${run.maxFanout}`,
  );
  if (run.budgetOutputTokens !== null) {
    console.log(`  Budget: ${run.budgetOutputTokens} output tokens`);
  }
  if (run.argsJson !== null) {
    console.log(`  Args: ${run.argsJson}`);
  }
  if (run.retention === "archived") {
    console.log("  Retention: archived (per-agent logs pruned; not resumable)");
  }
  const usage = run.usage;
  if (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.toolUses > 0 ||
    usage.durationMs > 0
  ) {
    console.log(
      `  Usage: ${usage.inputTokens} in / ${usage.outputTokens} out tokens, ${usage.toolUses} tool uses, ${formatDurationMs(usage.durationMs)}`,
    );
  }
  console.log(`  Created: ${new Date(run.createdAt).toLocaleString()}`);
  if (run.startedAt !== null) {
    console.log(`  Started: ${new Date(run.startedAt).toLocaleString()}`);
  }
  if (run.settledAt !== null) {
    console.log(`  Settled: ${new Date(run.settledAt).toLocaleString()}`);
  }
  console.log(`  Link: ${workflowRunDeepLink(serverUrl, run.id)}`);
  console.log("");
  console.log("Agents:");
  for (const line of formatWorkflowProgressTreeLines({
    indent: "  ",
    runState: workflowRunDisplayState(run.status),
    snapshot: run.progressSnapshot,
  })) {
    console.log(line);
  }
  if (run.resultJson !== null) {
    console.log("");
    console.log("Result:");
    console.log(run.resultJson);
  }
}
