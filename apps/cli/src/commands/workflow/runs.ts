import { Command } from "commander";
import type { WorkflowRunResponse } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { renderBorderlessTable } from "../../table.js";
import {
  outputJson,
  printContextLabel,
  requireProjectIdWithLabel,
} from "../helpers.js";
import { formatWorkflowAgentProgress } from "./helpers.js";

interface WorkflowRunsCommandOptions {
  project?: string;
  limit?: string;
  json?: boolean;
}

function parseRunsLimit(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error("Limit must be a positive integer.");
  }
  return value;
}

export function registerWorkflowRunsCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("runs")
    .description("List a project's workflow runs, newest first")
    .option("--project <id>", "Project ID (defaults to BB_PROJECT_ID)")
    .option("--limit <n>", "Maximum number of runs to return")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: WorkflowRunsCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const resolvedProject = requireProjectIdWithLabel(opts.project);
        printContextLabel(resolvedProject, "Project", "BB_PROJECT_ID", opts);
        const limit = parseRunsLimit(opts.limit);
        const runs = await sdk.workflows.listRuns({
          projectId: resolvedProject.id,
          ...(limit !== undefined ? { limit } : {}),
        });
        if (outputJson(opts, runs)) return;
        if (runs.length === 0) {
          console.log("No workflow runs found");
          return;
        }
        printWorkflowRunTable(runs);
      }),
    );
}

function printWorkflowRunTable(runs: WorkflowRunResponse[]): void {
  const rows = runs.map((run) => [
    run.id,
    run.workflowName,
    run.status,
    formatWorkflowAgentProgress(run.progressSnapshot),
    new Date(run.createdAt).toLocaleString(),
  ]);
  const idWidth = Math.max(2, ...rows.map((row) => row[0].length));
  const workflowWidth = Math.max(8, ...rows.map((row) => row[1].length));
  const statusWidth = Math.max(6, ...rows.map((row) => row[2].length));
  const agentsWidth = Math.max(6, ...rows.map((row) => row[3].length));
  const createdWidth = Math.max(7, ...rows.map((row) => row[4].length));
  const table = renderBorderlessTable(
    {
      head: ["ID", "Workflow", "Status", "Agents", "Created"],
      colWidths: [idWidth, workflowWidth, statusWidth, agentsWidth, createdWidth],
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
