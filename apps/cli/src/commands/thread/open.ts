import { Command } from "commander";
import type { PanelFileSource } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  outputJson,
  printContextLabel,
  requireThreadIdWithLabelOrSelf,
} from "../helpers.js";

interface ThreadOpenCommandOptions {
  self?: boolean;
  json?: boolean;
  source?: string;
  line?: string;
}

function parseSource(value: string | undefined): PanelFileSource {
  const normalized = (value ?? "workspace").trim().toLowerCase();
  if (normalized === "workspace" || normalized === "thread-storage") {
    return normalized;
  }
  throw new Error(
    `Invalid --source '${value}'. Expected 'workspace' or 'thread-storage'.`,
  );
}

function parseLine(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --line '${value}'. Expected a positive integer.`);
  }
  return parsed;
}

export function registerOpenCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("open <file> [id]")
    .description(
      "Open a file in the secondary panel of connected clients viewing the thread (defaults to BB_THREAD_ID)",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option(
      "--source <source>",
      "Path root: workspace or thread-storage (default workspace)",
    )
    .option("--line <number>", "Line number to scroll to")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          file: string,
          id: string | undefined,
          opts: ThreadOpenCommandOptions,
        ) => {
          const resolved = requireThreadIdWithLabelOrSelf(id, opts);
          const source = parseSource(opts.source);
          const lineNumber = parseLine(opts.line);
          printContextLabel(resolved, "Thread", "BB_THREAD_ID", opts);
          const sdk = createCliBbSdk(getUrl());
          const result = await sdk.threads.open({
            threadId: resolved.id,
            source,
            path: file,
            lineNumber,
          });
          if (outputJson(opts, result)) return;
          if (result.delivered > 0) {
            console.log(
              `Opened ${file} in ${result.delivered} connected client(s) — now, or when the thread is next viewed.`,
            );
          } else {
            console.log("No bb app is connected — nothing was opened.");
          }
        },
      ),
    );
}
