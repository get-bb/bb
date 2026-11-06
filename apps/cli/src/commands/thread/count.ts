import { flag } from "@bb/operations";
import type { Command } from "commander";
import {
  threadStatusSchema,
  threadStatusValues,
  type ThreadStatus,
} from "@bb/domain";
import {
  threadCountGroupBySchema,
  THREAD_COUNT_ROOT_PARENT,
  type ThreadCountGroupBy,
} from "@bb/server-contract";
import type { ThreadCountResult } from "@bb/sdk";
import { mountCommand, publicCommand } from "../../operation-doors.js";
import { columnWidths, printBorderlessTable } from "../../table.js";
import { joinValues } from "../helpers.js";

const GROUP_COLUMN_HEADS: Record<ThreadCountGroupBy, string> = {
  host: "Machine",
  provider: "Provider",
  project: "Project",
};

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const threadCountCommand = publicCommand("threads.count", {
  path: ["thread", "count"],
  summary:
    "Count threads without listing them; excludes archived and hidden threads",
  options: [
    flag(
      "--status <status>",
      `Count threads in this status: ${joinValues(threadStatusValues)}`,
    ),
    flag("--host <id>", "Count threads whose environment is on this machine"),
    flag("--provider <id>", "Count threads running on this provider"),
    flag("--project <id>", "Count threads in this project"),
    flag(
      "--parent <id|none>",
      `Count children of this thread, or '${THREAD_COUNT_ROOT_PARENT}' for threads with no parent`,
    ),
    flag("--by <dimension>", "Group the count by host, provider, or project"),
  ],
  prepare: ({ options }) => {
    const groupBy = parseGroupBy(stringOption(options.by));
    const status = stringOption(options.status);
    const hostId = stringOption(options.host);
    const providerId = stringOption(options.provider);
    const projectId = stringOption(options.project);
    const parentThreadId = stringOption(options.parent);
    return {
      ...(status ? { status: parseStatus(status) } : {}),
      ...(hostId ? { hostId } : {}),
      ...(providerId ? { providerId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(parentThreadId ? { parentThreadId } : {}),
      ...(groupBy ? { groupBy } : {}),
    };
  },
  print: (result, input) => printThreadCount(result, input.groupBy),
});

export function registerCountCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommand(parent, threadCountCommand, { getUrl });
}

/**
 * An ungrouped count is one number, so it prints as one number: the common
 * `bb thread count --status active` call stays pipeable without --json.
 */
function printThreadCount(
  result: ThreadCountResult,
  groupBy: ThreadCountGroupBy | undefined,
): string {
  if (result.groups === undefined || groupBy === undefined) {
    return String(result.total);
  }
  if (result.groups.length === 0) return "No threads found";
  return printGroupTable(result, groupBy);
}

function printGroupTable(
  result: ThreadCountResult,
  groupBy: ThreadCountGroupBy,
): string {
  // Biggest group first: the reason to group is to find where the threads are.
  const groups = [...(result.groups ?? [])].sort(
    (left, right) =>
      right.count - left.count || compareGroupKeys(left.key, right.key),
  );
  const rows = groups.map((group) => [group.key ?? "-", String(group.count)]);
  const head = [GROUP_COLUMN_HEADS[groupBy], "Count"];
  printBorderlessTable(
    {
      head,
      colWidths: columnWidths(rows, [head[0].length, head[1].length]),
    },
    rows,
  );
  return `Total: ${result.total}`;
}

/** Threads without a host/provider/project sort last under a "-" key. */
function compareGroupKeys(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function parseStatus(value: string): ThreadStatus {
  const parsed = threadStatusSchema.safeParse(value.trim());
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid --status value '${value}'. Expected ${joinValues(threadStatusValues)}.`,
  );
}

function parseGroupBy(
  value: string | undefined,
): ThreadCountGroupBy | undefined {
  if (value === undefined) return undefined;
  const parsed = threadCountGroupBySchema.safeParse(value.trim());
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid --by value '${value}'. Expected 'host', 'provider', or 'project'.`,
  );
}
