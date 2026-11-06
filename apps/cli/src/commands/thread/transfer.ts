import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

interface ThreadExportCommandOptions {
  json?: boolean;
  output?: string;
  self?: boolean;
}

interface ThreadImportCommandOptions {
  json?: boolean;
}

interface ThreadSaveCommandOptions {
  json?: boolean;
  self?: boolean;
}

interface SavedThreadListCommandOptions {
  json?: boolean;
  limit?: string;
  project?: string;
  search?: string;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerTransferCommands(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("export [id]")
    .description(
      "Save the thread and its full event history as a .jsonl.zst thread file",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option(
      "-o, --output <path>",
      "Where to write the file (default: ./<thread id>.jsonl.zst)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadExportCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const bytes = await createCliBbSdk(
            getUrl(),
          ).threads.experimental_export({
            threadId,
          });
          const path = resolve(opts.output ?? `${threadId}.jsonl.zst`);
          await writeFile(path, bytes);
          const result = { threadId, path, bytes: bytes.byteLength };
          if (outputJson(opts, result)) return;
          console.log(
            `Exported thread ${threadId} to ${path} (${bytes.byteLength.toLocaleString("en-US")} bytes)`,
          );
        },
      ),
    );

  parent
    .command("import <file>")
    .description(
      "Import a thread file into the thread it was exported from, adding events it no longer has",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (file: string, opts: ThreadImportCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.experimental_import({
          file: await readFile(resolve(file)),
        });
        if (outputJson(opts, result)) return;
        console.log(
          `Imported thread ${result.threadId}: added ${result.insertedRows.toLocaleString("en-US")} of ${result.rows.toLocaleString("en-US")} events`,
        );
      }),
    );

  parent
    .command("save [id]")
    .description(
      "Save the thread and its history to a thread file and remove it from the database",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadSaveCommandOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const result = await createCliBbSdk(getUrl()).threads.experimental_save(
          {
            threadId,
          },
        );
        if (outputJson(opts, result)) return;
        console.log(
          `Saving thread ${threadId}. It leaves the thread list once its file is written; see bb thread saved list.`,
        );
      }),
    );

  const saved = parent
    .command("saved")
    .description("List, restore or delete threads saved to thread files");

  saved
    .command("list")
    .description("List threads saved to files, newest first")
    .option("--project <id>", "Only threads from this project")
    .option("--search <text>", "Only threads whose title contains this text")
    .option("--limit <n>", "How many to list (default 50, at most 200)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: SavedThreadListCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.experimental_listSaved({
          ...(opts.project === undefined ? {} : { projectId: opts.project }),
          ...(opts.search === undefined ? {} : { search: opts.search }),
          ...(opts.limit === undefined
            ? {}
            : { limit: Number.parseInt(opts.limit, 10) }),
        });
        if (outputJson(opts, result)) return;
        if (result.savedThreads.length === 0) {
          console.log("No saved threads");
          return;
        }
        for (const entry of result.savedThreads) {
          const when =
            entry.savedAt === null
              ? entry.state
              : new Date(entry.savedAt).toLocaleString();
          console.log(
            `${entry.threadId}  ${entry.title ?? "(untitled)"}  ${when}  ${entry.rows.toLocaleString("en-US")} events  ${formatMegabytes(entry.packedBytes)}`,
          );
        }
        if (result.hasMore)
          console.log("More saved threads exist; use --limit or --search.");
      }),
    );

  saved
    .command("restore <id>")
    .description("Bring a saved thread back from its file")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ThreadImportCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.experimental_restoreSaved({
          threadId: id,
        });
        if (outputJson(opts, result)) return;
        console.log(
          `Restored thread ${result.threadId} (${result.rows.toLocaleString("en-US")} events)`,
        );
      }),
    );

  saved
    .command("delete <id>")
    .description("Permanently delete a saved thread's file")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ThreadImportCommandOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.experimental_deleteSaved({
          threadId: id,
        });
        if (outputJson(opts, result)) return;
        console.log(`Deleted saved thread ${id}`);
      }),
    );
}
