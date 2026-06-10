import { Command } from "commander";
import type { WorkflowListResponse } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { renderBorderlessTable } from "../../table.js";
import {
  outputJson,
  printContextLabel,
  requireProjectIdWithLabel,
} from "../helpers.js";

interface WorkflowListCommandOptions {
  project?: string;
  host?: string;
  json?: boolean;
}

export function registerWorkflowListCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("list")
    .description(
      "List workflow definitions visible to a project (project > user > builtin tiers)",
    )
    .option("--project <id>", "Project ID (defaults to BB_PROJECT_ID)")
    .option(
      "--host <id>",
      "Host whose project source resolves the listing root (defaults to the project's default source)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: WorkflowListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const resolvedProject = requireProjectIdWithLabel(opts.project);
        printContextLabel(resolvedProject, "Project", "BB_PROJECT_ID", opts);
        const workflows = await sdk.workflows.list({
          projectId: resolvedProject.id,
          ...(opts.host ? { hostId: opts.host } : {}),
        });
        if (outputJson(opts, workflows)) return;
        if (workflows.length === 0) {
          console.log("No workflows found");
          return;
        }
        printWorkflowTable(workflows);
      }),
    );
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function printWorkflowTable(workflows: WorkflowListResponse): void {
  const rows = workflows.map((workflow) => [
    workflow.name,
    workflow.tier,
    truncate(workflow.description, 70),
  ]);
  const nameWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const tierWidth = Math.max(4, ...rows.map((row) => row[1].length));
  const descriptionWidth = Math.max(11, ...rows.map((row) => row[2].length));
  const table = renderBorderlessTable(
    {
      head: ["Name", "Tier", "Description"],
      colWidths: [nameWidth, tierWidth, descriptionWidth],
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}
