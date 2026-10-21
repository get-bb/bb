import type { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";

export function registerHoldoutCommands(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("holdouts")
    .description("Inspect this install's holdout assignments")
    .command("list")
    .description("List persisted holdout assignments")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: { json?: boolean }) => {
        const result = await createCliBbSdk(getUrl()).system.holdouts();
        if (outputJson(opts, result)) return;
        if (result.assignments.length === 0) {
          console.log("No holdout assignments");
          return;
        }
        const rows = result.assignments.map((row) => [
          row.key,
          row.variant,
          new Date(row.assignedAt).toISOString(),
          row.exposedAt === null ? "—" : new Date(row.exposedAt).toISOString(),
          row.status,
        ]);
        printBorderlessTable(
          {
            head: ["Key", "Variant", "Assigned", "Exposed", "Status"],
            colWidths: columnWidths(rows, [3, 7, 8, 7, 6]),
            trimTrailingWhitespace: true,
          },
          rows,
        );
      }),
    );
}
