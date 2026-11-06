import type { Command } from "commander";
import type { PromptHistoryListEntry } from "@bb/domain";
import { flag } from "../cli-door.js";
import { mountCommands, publicCommand } from "../operation-doors.js";
import { columnWidths, printBorderlessTable, truncateCell } from "../table.js";

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

export const promptHistoryCommands = [
  publicCommand("promptHistory.list", {
    path: ["prompt-history", "list"],
    summary: "List prompt history newest first",
    options: {
      cursor: flag("--cursor <cursor>", "Continue from an earlier page"),
      limit: flag("--limit <number>", "Maximum entries to return"),
    },
    print(result, input) {
      if (result.entries.length === 0) {
        console.log("No prompt history found");
      } else {
        printPromptHistoryTable(result.entries);
      }
      if (result.nextCursor !== null) {
        const limit =
          input.limit === undefined ? "" : ` --limit ${input.limit}`;
        console.log(
          `Next page: bb prompt-history list --cursor ${result.nextCursor}${limit}`,
        );
      }
      return null;
    },
  }),
];

export function registerPromptHistoryCommands(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("prompt-history")
    .description("List prompt history across threads and projects");
  mountCommands(program, promptHistoryCommands, { getUrl });
}
