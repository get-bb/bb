import { rmSync } from "node:fs";
import type { Command } from "commander";
import { flag } from "../cli-door.js";
import {
  type CliErrorLogEntry,
  formatCliErrorLogPath,
  isCliErrorLogEnabled,
  readCliErrorLogEntries,
  resolveCliErrorLogLocation,
} from "../cli-error-log.js";
import { parseDurationMs } from "../duration.js";
import { clientCommand, mountCommands } from "../operation-doors.js";
import { columnWidths, printBorderlessTable } from "../table.js";

export interface CliErrorTallyRow {
  code: string;
  command: string;
  count: number;
  lastAt: string;
  token: string | null;
}

export function tallyCliErrors(
  entries: readonly CliErrorLogEntry[],
): CliErrorTallyRow[] {
  const rows = new Map<string, CliErrorTallyRow>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.command, entry.code, entry.token]);
    const existing = rows.get(key);
    if (existing === undefined) {
      rows.set(key, {
        code: entry.code,
        command: entry.command,
        count: 1,
        lastAt: entry.at,
        token: entry.token,
      });
      continue;
    }
    existing.count += 1;
    if (entry.at > existing.lastAt) existing.lastAt = entry.at;
  }
  return [...rows.values()].sort(
    (left, right) =>
      right.count - left.count || right.lastAt.localeCompare(left.lastAt),
  );
}

type CliErrorsOutput =
  | { kind: "cleared"; logPath: string }
  | {
      kind: "tally";
      enabled: boolean;
      logPath: string;
      total: number;
      rows: CliErrorTallyRow[];
    };

export const cliErrorsCommand = clientCommand({
  path: ["diagnostics", "cli-errors"],
  summary:
    "Tally failed bb invocations recorded on this machine, most frequent first (records the command path, error code, and the unknown command or flag; never argument values)",
  options: {
    since: flag(
      "--since <duration>",
      "Only count failures newer than this (for example 24h or 7d)",
    ),
    clear: flag("--clear", "Delete the recorded failures"),
  },
  async run({ options: { clear, since } }): Promise<CliErrorsOutput> {
    const location = resolveCliErrorLogLocation();
    const logPath = formatCliErrorLogPath(location);
    if (clear) {
      rmSync(logPath, { force: true });
      rmSync(`${logPath}.1`, { force: true });
      return { kind: "cleared", logPath };
    }
    const cutoff =
      since === undefined
        ? null
        : new Date(
            Date.now() -
              parseDurationMs({
                allowZero: false,
                defaultUnit: "h",
                label: "--since",
                value: since,
              }),
          ).toISOString();
    const entries = readCliErrorLogEntries(location).filter(
      (entry) => cutoff === null || entry.at >= cutoff,
    );
    return {
      kind: "tally",
      enabled: isCliErrorLogEnabled(),
      logPath,
      total: entries.length,
      rows: tallyCliErrors(entries),
    };
  },
  json(output) {
    if (output.kind === "cleared") return { ok: true, logPath: output.logPath };
    return {
      enabled: output.enabled,
      logPath: output.logPath,
      total: output.total,
      rows: output.rows,
    };
  },
  print(output) {
    if (output.kind === "cleared") return `Cleared ${output.logPath}`;
    if (!output.enabled) {
      console.log("Recording is off (BB_CLI_ERROR_LOG=0).");
    }
    if (output.rows.length === 0) {
      return `No failed bb invocations recorded in ${output.logPath}`;
    }
    const tableRows = output.rows.map((row) => [
      String(row.count),
      row.command.length === 0 ? "(top level)" : row.command,
      row.code,
      row.token ?? "",
      row.lastAt,
    ]);
    printBorderlessTable(
      {
        head: ["Count", "Command", "Code", "Token", "Last seen"],
        colWidths: columnWidths(tableRows, [6, 28, 28, 24, 26]),
      },
      tableRows,
    );
    return `\n${output.total} failures in ${output.logPath}`;
  },
});

export function registerDiagnosticsCommands(program: Command): void {
  program
    .command("diagnostics")
    .description("Inspect local bb CLI diagnostics");
  mountCommands(program, [cliErrorsCommand], { getUrl: () => "" });
}
