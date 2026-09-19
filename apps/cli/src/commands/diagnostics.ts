import { rmSync } from "node:fs";
import { Command } from "commander";
import { action } from "../action.js";
import {
  type CliErrorLogEntry,
  formatCliErrorLogPath,
  isCliErrorLogEnabled,
  readCliErrorLogEntries,
  resolveCliErrorLogLocation,
} from "../cli-error-log.js";
import { parseDurationMs } from "../duration.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";

interface CliErrorsOptions {
  clear?: boolean;
  json?: boolean;
  since?: string;
}

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

export function registerDiagnosticsCommands(program: Command): void {
  const diagnostics = program
    .command("diagnostics")
    .description("Inspect local bb CLI diagnostics");

  diagnostics
    .command("cli-errors")
    .description(
      "Tally failed bb invocations recorded on this machine, most frequent first (records the command path, error code, and the unknown command or flag; never argument values)",
    )
    .option(
      "--since <duration>",
      "Only count failures newer than this (for example 24h or 7d)",
    )
    .option("--clear", "Delete the recorded failures")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: CliErrorsOptions) => {
        const location = resolveCliErrorLogLocation();
        const logPath = formatCliErrorLogPath(location);
        if (opts.clear) {
          rmSync(logPath, { force: true });
          rmSync(`${logPath}.1`, { force: true });
          if (outputJson(opts, { ok: true, logPath })) return;
          console.log(`Cleared ${logPath}`);
          return;
        }
        const cutoff =
          opts.since === undefined
            ? null
            : new Date(
                Date.now() -
                  parseDurationMs({
                    allowZero: false,
                    defaultUnit: "h",
                    label: "--since",
                    value: opts.since,
                  }),
              ).toISOString();
        const entries = readCliErrorLogEntries(location).filter(
          (entry) => cutoff === null || entry.at >= cutoff,
        );
        const rows = tallyCliErrors(entries);
        if (
          outputJson(opts, {
            enabled: isCliErrorLogEnabled(),
            logPath,
            total: entries.length,
            rows,
          })
        ) {
          return;
        }
        if (!isCliErrorLogEnabled()) {
          console.log("Recording is off (BB_CLI_ERROR_LOG=0).");
        }
        if (rows.length === 0) {
          console.log(`No failed bb invocations recorded in ${logPath}`);
          return;
        }
        const tableRows = rows.map((row) => [
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
        console.log(`\n${entries.length} failures in ${logPath}`);
      }),
    );
}
