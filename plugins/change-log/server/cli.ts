import type { ChangeEntry } from "../shared/contract.js";
import type { BuildChangeLogResult } from "./build.js";

export const CHANGE_LOG_CLI_USAGE = [
  "Usage: bb change-log list <thread-id> [options]",
  "",
  "Show a thread's file-change history, newest first.",
  "",
  "Options:",
  "  --path <query>   Only changes whose path contains this text",
  "  --limit <n>      Print at most n changes (default 50)",
  "  --patches        Include unified diffs in text output",
  "  --json           Print the full result as JSON",
  "  --json-patches   Include unified diffs in JSON output",
].join("\n");

export interface FormatChangeLogArgs {
  limit: number;
  pathQuery: string;
  withPatches: boolean;
}

function finalPathOf(entry: ChangeEntry): string {
  return entry.movePath ?? entry.path;
}

function matchesQuery(entry: ChangeEntry, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return (
    entry.path.toLowerCase().includes(needle) ||
    (entry.movePath ?? "").toLowerCase().includes(needle)
  );
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function selectCliEntries(
  result: BuildChangeLogResult,
  args: FormatChangeLogArgs,
): ChangeEntry[] {
  const filtered = result.entries.filter((entry) =>
    matchesQuery(entry, args.pathQuery),
  );
  return filtered.slice(Math.max(0, filtered.length - args.limit));
}

export function formatChangeLogList(
  result: BuildChangeLogResult,
  args: FormatChangeLogArgs,
): string {
  const entries = selectCliEntries(result, args);
  if (entries.length === 0) {
    return "No file changes recorded for this thread.";
  }
  const turnIndex = new Map(
    result.turns.map((turn, index) => [turn.turnId, index + 1]),
  );
  const lines: string[] = [];
  for (const entry of entries) {
    const turn = entry.turnId === null ? "" : turnIndex.get(entry.turnId);
    lines.push(
      [
        formatClockTime(entry.createdAt),
        entry.action.padEnd(8),
        finalPathOf(entry),
        entry.added + entry.removed > 0
          ? `+${entry.added} -${entry.removed}`
          : "changed",
        entry.edits > 1 ? `${entry.edits} edits` : "",
        turn === undefined || turn === "" ? "" : `turn ${turn}`,
      ]
        .filter((part) => part !== "")
        .join("  "),
    );
    if (args.withPatches && entry.patch !== null) {
      for (const line of entry.patch.trimEnd().split("\n")) {
        lines.push(`    ${line}`);
      }
    }
    if (entry.patchTruncated) {
      lines.push("    [patch omitted: too large]");
    }
  }
  return lines.join("\n");
}
