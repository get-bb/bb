import { Command } from "commander";
import type { PromptHistoryListEntry } from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { columnWidths, printBorderlessTable, truncateCell } from "../table.js";
import { outputJson } from "./helpers.js";

interface PromptHistoryListOptions {
  cursor?: string;
  json?: boolean;
  limit?: string;
}

const PROMPT_COLUMN_WIDTH = 80;

function promptText(entry: PromptHistoryListEntry): string {
  return entry.input
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "image":
        case "localImage":
          return "[image]";
        case "localFile":
          return `[file ${part.name ?? part.path}]`;
      }
    })
    .join(" ");
}

function printPromptHistoryTable(entries: PromptHistoryListEntry[]): void {
  const rows = entries.map((entry) => [
    new Date(entry.createdAt).toISOString(),
    entry.threadId,
    truncateCell(promptText(entry), PROMPT_COLUMN_WIDTH),
  ]);
  printBorderlessTable(
    {
      head: ["Created", "Thread", "Prompt"],
      colWidths: columnWidths(rows, [7, 6, 6]),
      trimTrailingWhitespace: true,
    },
    rows,
  );
}

export function registerPromptHistoryCommands(
  program: Command,
  getUrl: () => string,
): void {
  const promptHistory = program
    .command("prompt-history")
    .description("List prompt history across threads and projects");

  promptHistory
    .command("list")
    .description("List prompt history newest first")
    .option("--cursor <cursor>", "Continue from an earlier page")
    .option("--limit <number>", "Maximum entries to return")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: PromptHistoryListOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const result = await sdk.experimental_promptHistory.list({
          cursor: opts.cursor,
          limit: opts.limit,
        });
        if (outputJson(opts, result)) return;
        if (result.entries.length === 0) {
          console.log("No prompt history found");
        } else {
          printPromptHistoryTable(result.entries);
        }
        if (result.nextCursor !== null) {
          const limit =
            opts.limit === undefined ? "" : ` --limit ${opts.limit}`;
          console.log(
            `Next page: bb prompt-history list --cursor ${result.nextCursor}${limit}`,
          );
        }
      }),
    );
}
