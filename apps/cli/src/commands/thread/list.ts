import { Command } from "commander";
import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { resolveExplicitIdFlag } from "../../context-env.js";
import { renderBorderlessTable } from "../../table.js";
import { outputJson } from "../helpers.js";

interface ThreadListCommandOptions {
  project?: string;
  parentThread?: string;
  archived?: boolean;
  section?: string;
  unsectioned?: boolean;
  json?: boolean;
  includeHidden?: boolean;
}

export function registerListCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("list")
    .description("List threads")
    .option("--project <id>", "Filter by project ID (defaults to all projects)")
    .option("--parent-thread <id>", "Filter by parent thread ID")
    .option("--section <id>", "Filter by thread section ID")
    .option("--unsectioned", "Show only threads outside sections")
    .option("--archived", "Show only archived threads")
    .option("--include-hidden", "Include hidden threads")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ThreadListCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const projectId = resolveExplicitIdFlag({
          flagName: "--project flag",
          value: opts.project,
        });
        const parentThreadId = resolveExplicitIdFlag({
          flagName: "--parent-thread",
          value: opts.parentThread,
        });
        if (opts.section && opts.unsectioned) {
          throw new Error("Cannot combine --section with --unsectioned.");
        }
        const sectionId = resolveExplicitIdFlag({
          flagName: "--section",
          value: opts.section,
        });
        const threads = await sdk.threads.list({
          ...(projectId ? { projectId } : {}),
          ...(parentThreadId ? { parentThreadId } : {}),
          ...(opts.archived ? { archived: true } : {}),
          ...(sectionId ? { sectionId } : {}),
          ...(opts.unsectioned ? { unsectioned: true } : {}),
          ...(opts.includeHidden ? { includeHidden: true } : {}),
        });
        if (outputJson(opts, threads)) return;
        if (threads.length === 0) {
          console.log("No threads found");
          return;
        }
        printThreadTable(threads);
      }),
    );
}

function printThreadTable(threads: Thread[]): void {
  const rows = threads.map((thread) => [
    thread.id,
    thread.projectId === PERSONAL_PROJECT_ID ? "-" : thread.projectId,
    formatThreadListStatus(thread),
  ]);
  const idWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const projectWidth = Math.max(7, ...rows.map((row) => row[1].length));
  const statusWidth = Math.max(12, ...rows.map((row) => row[2].length));
  const table = renderBorderlessTable(
    {
      head: ["ID", "Project", "Status"],
      colWidths: [idWidth, projectWidth, statusWidth],
    },
    rows,
  );

  console.log("");
  console.log(table);
  console.log("");
}

function formatThreadListStatus(thread: Thread): string {
  const flags: string[] = [];
  if (thread.archivedAt !== null) {
    flags.push("archived");
  }
  if (thread.pinnedAt !== null) {
    flags.push("pinned");
  }
  if (flags.length === 0) {
    return thread.status;
  }
  return `${thread.status} (${flags.join(", ")})`;
}
