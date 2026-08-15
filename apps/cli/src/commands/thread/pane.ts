import { Command } from "commander";
import { threadPaneActionSchema } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../../context-env.js";
import { outputJson, printContextLabel, type ResolvedId } from "../helpers.js";

interface ThreadPaneCommandOptions {
  json?: boolean;
}

function resolveThreadPaneTarget(id: string | undefined): ResolvedId {
  const explicit = resolveExplicitIdFlag({
    flagName: "<threadId> argument",
    value: id,
  });
  if (explicit !== undefined) {
    return { id: explicit, source: "arg" };
  }
  const context = resolveContextThreadId();
  if (context !== undefined) {
    return { id: context, source: "env" };
  }
  throw new Error(
    "Missing thread ID. Pass <threadId> or run inside a BB thread.",
  );
}

export function registerPaneCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("pane")
    .description("Control an open thread pane in connected BB apps")
    .usage("<maximize|restore|toggle|spotlight|clear-spotlight> [id] [options]")
    .argument(
      "<action>",
      "Pane action: maximize, restore, toggle, spotlight, or clear-spotlight",
    )
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          actionInput: string,
          id: string | undefined,
          opts: ThreadPaneCommandOptions,
        ) => {
          const paneAction = threadPaneActionSchema.parse(actionInput);
          const target = resolveThreadPaneTarget(id);
          const result = await createCliBbSdk(getUrl()).threads.paneAction({
            action: paneAction,
            threadId: target.id,
          });
          if (
            outputJson(opts, {
              threadId: target.id,
              action: paneAction,
              delivered: result.delivered,
            })
          ) {
            return;
          }
          printContextLabel(target, "Thread", "BB_THREAD_ID", opts);
          console.log(`Thread: ${target.id}`);
          console.log(`Pane action: ${paneAction}`);
          console.log(`Delivered: ${result.delivered}`);
        },
      ),
    );
}
