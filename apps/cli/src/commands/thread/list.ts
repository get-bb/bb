import type { Command } from "commander";
import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import type { PublicOperationInput } from "@bb/server-contract";
import { flag } from "../../cli-door.js";
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
import { JSON_FLAG } from "./operation-doors.js";

interface ThreadListOutput {
  threads: Thread[];
  projectNames: ReadonlyMap<string, string>;
}

export const threadListCommand = clientCommand({
  path: ["thread", "list"],
  summary: "List threads",
  options: {
    project: flag(
      "--project <id>",
      "Filter by project ID (defaults to all projects)",
    ),
    environment: flag("--environment <id>", "Filter by environment ID"),
    machine: flag(
      "--machine <id-or-name>",
      "Filter by machine ID or active machine name",
    ),
    host: flag("--host <id-or-name>", "Alias for --machine"),
    parentThread: flag("--parent-thread <id>", "Filter by parent thread ID"),
    thread: flag(
      "--thread <id>",
      "Show only this thread ID, leaving out unknown or deleted IDs (repeatable, up to 200)",
      { type: "strings", default: [] },
    ),
    section: flag("--section <id>", "Filter by thread section ID"),
    unsectioned: flag("--unsectioned", "Show only threads outside sections"),
    archived: flag("--archived", "Show only archived threads"),
    includeArchived: flag("--include-archived", "Include archived threads"),
    includeHidden: flag("--include-hidden", "Include hidden threads"),
    json: JSON_FLAG,
  },
  run: async ({ options }, client): Promise<ThreadListOutput> => {
    const projectId = resolveExplicitIdFlag({
      flagName: "--project flag",
      value: options.project,
    });
    const parentThreadId = resolveExplicitIdFlag({
      flagName: "--parent-thread",
      value: options.parentThread,
    });
    const threadIds = options.thread.flatMap(
      (value) => resolveExplicitIdFlag({ flagName: "--thread", value }) ?? [],
    );
    const environmentId = resolveExplicitIdFlag({
      flagName: "--environment",
      value: options.environment,
    });
    const machineTarget = resolveMachineTargetOption({
      machine: options.machine,
      host: options.host,
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
    if (options.archived && options.includeArchived) {
      throw new Error("Cannot combine --archived with --include-archived.");
    }
    if (options.section && options.unsectioned) {
      throw new Error("Cannot combine --section with --unsectioned.");
    }
    const sectionId = resolveExplicitIdFlag({
      flagName: "--section",
      value: options.section,
    });
    const archived = options.archived
      ? true
      : options.includeArchived || threadIds.length > 0
        ? undefined
        : false;
    const query: PublicOperationInput<"threads.list"> = {
      ...(projectId ? { projectId } : {}),
      ...(environmentId ? { environmentId } : {}),
      ...(hostId ? { hostId } : {}),
      ...(parentThreadId ? { parentThreadId } : {}),
      ...(threadIds.length > 0 ? { threadIds: threadIds.join(",") } : {}),
      ...(archived === undefined
        ? {}
        : { archived: archived ? "true" : "false" }),
      ...(sectionId ? { sectionId } : {}),
      ...(options.unsectioned ? { unsectioned: "true" } : {}),
      ...(options.includeHidden ? { includeHidden: "true" } : {}),
    };
    const threads = await client.call("threads.list", query);
    if (options.json || threads.length === 0) {
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
