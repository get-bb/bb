import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface HistoryListOptions {
  cursor?: string;
  json?: boolean;
  limit?: string;
}

export function registerHistoryCommands(
  program: Command,
  getUrl: () => string,
): void {
  const history = program
    .command("history")
    .description("List prompt history across threads and projects");

  history
    .command("list")
    .description("List prompt history newest first")
    .option("--cursor <cursor>", "Continue from an earlier page")
    .option("--limit <number>", "Maximum entries to return")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: HistoryListOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const result = await sdk.promptHistory.list({
          cursor: opts.cursor,
          limit: opts.limit,
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );
}
