import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { printBorderlessTable } from "../../table.js";
import {
  outputJson,
  prependErrorContext,
  requireThreadIdOrSelf,
} from "../helpers.js";

interface ThreadSubagentOptions {
  self?: boolean;
  json?: boolean;
}

export function registerSubagentCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const subagents = parent
    .command("subagents")
    .description("Inspect, message, and cancel provider subagents");

  subagents
    .command("list [id]")
    .description("List subagents for a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadSubagentOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const items = await sdk.threads.subagents
          .list({ threadId })
          .catch((error: unknown) => {
            throw prependErrorContext(
              `Failed to list subagents for thread ${threadId}`,
              error,
            );
          });
        if (outputJson(opts, items)) {
          return;
        }
        if (items.length === 0) {
          console.log("No subagents found");
          return;
        }
        printBorderlessTable(
          {
            head: ["Child", "Label", "Status", "Parent call"],
            colWidths: [38, 36, 14, 36],
            trimTrailingWhitespace: true,
          },
          items.map((item) => [
            item.childRef,
            item.label,
            item.status,
            item.parentToolCallId,
          ]),
        );
      }),
    );

  subagents
    .command("tell <childRef> <text> [id]")
    .description("Send a message to a subagent")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          childRef: string,
          text: string,
          id: string | undefined,
          opts: ThreadSubagentOptions,
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const result = await sdk.threads.subagents
            .tell({ threadId, childRef, text })
            .catch((error: unknown) => {
              throw prependErrorContext(
                `Failed to message subagent ${childRef}`,
                error,
              );
            });
          if (outputJson(opts, result)) {
            return;
          }
          console.log(
            `Message ${result.messageId} accepted for subagent ${result.childRef}`,
          );
        },
      ),
    );

  subagents
    .command("cancel <childRef> [id]")
    .description("Cancel a running subagent without stopping its parent")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          childRef: string,
          id: string | undefined,
          opts: ThreadSubagentOptions,
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const result = await sdk.threads.subagents
            .cancel({ threadId, childRef })
            .catch((error: unknown) => {
              throw prependErrorContext(
                `Failed to cancel subagent ${childRef}`,
                error,
              );
            });
          if (outputJson(opts, result)) {
            return;
          }
          console.log(`Subagent ${result.childRef} cancelled`);
        },
      ),
    );
}
