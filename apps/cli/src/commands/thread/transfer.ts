import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson } from "../../command-result.js";
import { requireThreadIdOrSelf } from "../helpers.js";

interface ThreadExportCommandOptions {
  json?: boolean;
  output?: string;
  self?: boolean;
}

interface ThreadImportCommandOptions {
  json?: boolean;
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
    .description("Import a thread file to bring back a deleted thread")
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
          `Imported thread ${result.threadId} with ${result.rows.toLocaleString("en-US")} events`,
        );
      }),
    );
}
