import { flag } from "@bb/operations";
import type { Command } from "commander";
import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import type { PublicOperationInput } from "@bb/server-contract";
import { clientCommand, mountCommand } from "../../operation-doors.js";
import { resolveExplicitIdFlag } from "../../context-env.js";
import {
  columnWidths,
  printBorderlessTable,
  truncateCell,
} from "../../table.js";
import {
  resolveMachineHostId,
  resolveMachineTargetOption,
} from "../machine.js";

type ThreadListQuery = PublicOperationInput<"threads.list">;

interface ThreadListInput {
  query: ThreadListQuery;
  json: boolean;
}

interface ThreadListOutput {
  threads: Thread[];
  projectNames: ReadonlyMap<string, string>;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const threadListCommand = clientCommand<
  ThreadListInput,
  ThreadListOutput
>({
  name: "cli.thread.list",
  kind: "read",
  description:
    "List threads with threads.list, then name their projects with projects.list for the table",
  door: {
    path: ["thread", "list"],
    summary: "List threads",
    options: [
      flag("--project <id>", "Filter by project ID (defaults to all projects)"),
      flag("--environment <id>", "Filter by environment ID"),
      flag(
        "--machine <id-or-name>",
        "Filter by machine ID or active machine name",
      ),
      flag("--host <id-or-name>", "Alias for --machine"),
      flag("--parent-thread <id>", "Filter by parent thread ID"),
      flag(
        "--thread <id>",
        "Show only this thread ID, leaving out unknown or deleted IDs (repeatable, up to 200)",
        { type: "strings", default: [] },
      ),
      flag("--section <id>", "Filter by thread section ID"),
      flag("--unsectioned", "Show only threads outside sections"),
      flag("--archived", "Show only archived threads"),
      flag("--include-archived", "Include archived threads"),
      flag("--include-hidden", "Include hidden threads"),
    ],
    prepare: async ({ options }, client) => {
      const projectId = resolveExplicitIdFlag({
        flagName: "--project flag",
        value: stringOption(options.project),
      });
      const parentThreadId = resolveExplicitIdFlag({
        flagName: "--parent-thread",
        value: stringOption(options["parent-thread"]),
      });
      const threadValues = Array.isArray(options.thread) ? options.thread : [];
      const threadIds = threadValues.flatMap(
        (value) => resolveExplicitIdFlag({ flagName: "--thread", value }) ?? [],
      );
      const environmentId = resolveExplicitIdFlag({
        flagName: "--environment",
        value: stringOption(options.environment),
      });
      const machineTarget = resolveMachineTargetOption({
        machine: stringOption(options.machine),
        host: stringOption(options.host),
      });
      const hostId =
        machineTarget === undefined
          ? undefined
          : machineTarget.trim().startsWith("host_")
            ? resolveExplicitIdFlag({
                flagName: "--machine",
                value: machineTarget,
              })
            : await resolveMachineHostId({
                serverUrl: client.url,
                target: machineTarget,
              });
      const archivedOnly = options.archived === true;
      if (archivedOnly && options["include-archived"] === true) {
        throw new Error("Cannot combine --archived with --include-archived.");
      }
      const section = stringOption(options.section);
      if (section && options.unsectioned === true) {
        throw new Error("Cannot combine --section with --unsectioned.");
      }
      const sectionId = resolveExplicitIdFlag({
        flagName: "--section",
        value: section,
      });
      const archived = archivedOnly
        ? true
        : options["include-archived"] === true || threadIds.length > 0
          ? undefined
          : false;
      return {
        json: options.json === true,
        query: {
          ...(projectId ? { projectId } : {}),
          ...(environmentId ? { environmentId } : {}),
          ...(hostId ? { hostId } : {}),
          ...(parentThreadId ? { parentThreadId } : {}),
          ...(threadIds.length > 0 ? { threadIds: threadIds.join(",") } : {}),
          ...(archived === undefined
            ? {}
            : { archived: archived ? "true" : "false" }),
          ...(sectionId ? { sectionId } : {}),
          ...(options.unsectioned === true ? { unsectioned: "true" } : {}),
          ...(options["include-hidden"] === true
            ? { includeHidden: "true" }
            : {}),
        },
      };
    },
    run: async ({ query, json }, client) => {
      const threads = await client.call("threads.list", query);
      if (json || threads.length === 0) {
        return { threads, projectNames: new Map() };
      }
      const projects = await client.call("projects.list", {
        includePersonal: "false",
      });
      return {
        threads,
        projectNames: new Map(
          projects.map((project) => [project.id, project.name]),
        ),
      };
    },
    json: ({ threads }) => threads,
    print: ({ threads, projectNames }) => {
      if (threads.length === 0) return "No threads found";
      printThreadTable(threads, projectNames);
      return null;
    },
  },
});

export function registerListCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommand(parent, threadListCommand, { getUrl });
}

const MAX_TITLE_WIDTH = 60;

function printThreadTable(
  threads: Thread[],
  projectNames: ReadonlyMap<string, string>,
): void {
  const rows = threads.map((thread) => [
    thread.id,
    truncateCell(formatThreadListTitle(thread), MAX_TITLE_WIDTH),
    formatThreadListProject(thread, projectNames),
    formatThreadListStatus(thread),
  ]);
  printBorderlessTable(
    {
      head: ["ID", "Title", "Project", "Status"],
      colWidths: columnWidths(rows, [4, 5, 7, 12]),
    },
    rows,
  );
}

function formatThreadListTitle(thread: Thread): string {
  const title = thread.title?.trim();
  if (title) return title;
  const fallback = thread.titleFallback?.trim();
  if (fallback) return fallback;
  return "-";
}

function formatThreadListProject(
  thread: Thread,
  projectNames: ReadonlyMap<string, string>,
): string {
  if (thread.projectId === PERSONAL_PROJECT_ID) return "-";
  return projectNames.get(thread.projectId) ?? thread.projectId;
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
