import { Command } from "commander";
import { updateThreadTabsRequestSchema } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  confirmDestructiveAction,
  outputJson,
  requireThreadIdOrSelf,
} from "../helpers.js";

interface JsonOptions {
  json?: boolean;
}

interface SelfOptions extends JsonOptions {
  self?: boolean;
}

interface FolderDeleteOptions extends JsonOptions {
  yes?: boolean;
}

interface SearchOptions extends JsonOptions {
  limit?: string;
}

interface HistoryOptions extends JsonOptions {
  limit?: string;
}

interface QueueCreateOptions extends JsonOptions {
  model?: string;
}

interface QueueSendOptions extends JsonOptions {
  mode?: "auto" | "steer";
}

interface QueueReorderOptions extends JsonOptions {
  after?: string;
  before?: string;
  groupBoundary?: string;
}

interface QueueGroupOptions extends JsonOptions {
  prefix: string;
}

interface ReorderPinnedOptions extends JsonOptions {
  after?: string;
  before?: string;
}

function parsePositiveInteger(
  value: string | undefined,
  flag: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value) || Number(value) < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}

function printHumanJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function registerOrganizationCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const folder = parent.command("folder").description("Manage thread folders");

  folder
    .command("list")
    .description("List thread folders")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const folders = await createCliBbSdk(getUrl()).threadFolders.list();
        if (outputJson(opts, folders)) return;
        if (folders.length === 0) {
          console.log("No thread folders found");
          return;
        }
        for (const item of folders) console.log(`${item.id}\t${item.name}`);
      }),
    );

  folder
    .command("create <name>")
    .description("Create a thread folder")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (name: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).threadFolders.create({
          name,
        });
        if (outputJson(opts, result)) return;
        console.log(`Thread folder ${result.id} created: ${result.name}`);
      }),
    );

  folder
    .command("rename <id> <name>")
    .description("Rename a thread folder")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, name: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).threadFolders.update({
          id,
          name,
        });
        if (outputJson(opts, result)) return;
        console.log(`Thread folder ${result.id} renamed: ${result.name}`);
      }),
    );

  folder
    .command("delete <id>")
    .description("Delete a thread folder and unfile its threads")
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: FolderDeleteOptions) => {
        if (
          !opts.yes &&
          !(await confirmDestructiveAction(`Delete thread folder ${id}?`))
        )
          return;
        const result = await createCliBbSdk(getUrl()).threadFolders.delete({
          id,
        });
        if (outputJson(opts, result)) return;
        console.log(
          `Thread folder ${result.id} deleted; ${result.updatedThreadCount} thread(s) unfiled`,
        );
      }),
    );

  parent
    .command("search <query>")
    .description("Search threads and messages")
    .option("--limit <count>", "Maximum results per group")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (query: string, opts: SearchOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.search({
          query,
          limitPerGroup: parsePositiveInteger(opts.limit, "--limit"),
        });
        if (outputJson(opts, result)) return;
        printHumanJson(result);
      }),
    );

  parent
    .command("history <id>")
    .description("List a thread's prompt history")
    .option("--limit <count>", "Maximum history entries")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: HistoryOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.promptHistory({
          threadId: id,
          limit: parsePositiveInteger(opts.limit, "--limit"),
        });
        if (outputJson(opts, result)) return;
        printHumanJson(result);
      }),
    );

  for (const [name, markRead] of [
    ["read", true],
    ["unread", false],
  ] as const) {
    parent
      .command(`${name} [id]`)
      .description(`Mark a thread ${name}`)
      .option("--self", "Target the current thread (from BB_THREAD_ID)")
      .option("--json", "Print machine-readable JSON output")
      .action(
        action(async (id: string | undefined, opts: SelfOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const result = markRead
            ? await sdk.threads.markRead({ threadId })
            : await sdk.threads.markUnread({ threadId });
          if (outputJson(opts, result)) return;
          console.log(`Thread ${threadId} marked ${name}`);
        }),
      );
  }

  parent
    .command("reorder-pinned <id>")
    .description("Move a pinned thread between adjacent pinned threads")
    .option("--after <id>", "Previous pinned thread, or omit for the start")
    .option("--before <id>", "Next pinned thread, or omit for the end")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ReorderPinnedOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.reorderPinned({
          threadId: id,
          previousThreadId: opts.after ?? null,
          nextThreadId: opts.before ?? null,
        });
        if (outputJson(opts, result)) return;
        console.log(`Pinned thread ${id} reordered`);
      }),
    );

  const queue = parent
    .command("queue")
    .description("Manage queued thread messages");
  queue
    .command("list <threadId>")
    .description("List queued messages")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.queuedMessages.list({ threadId });
        if (outputJson(opts, result)) return;
        printHumanJson(result);
      }),
    );
  queue
    .command("create <threadId> <message>")
    .description("Create a queued text message")
    .option("--model <model>", "Model override for the queued message")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (threadId: string, message: string, opts: QueueCreateOptions) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.queuedMessages.create({
            threadId,
            input: [{ type: "text", text: message, mentions: [] }],
            ...(opts.model ? { model: opts.model } : {}),
          });
          if (outputJson(opts, result)) return;
          console.log(
            `Queued message ${result.id} created for thread ${threadId}`,
          );
        },
      ),
    );
  queue
    .command("send <threadId> <messageId>")
    .description("Send and remove a queued message")
    .option("--mode <mode>", "Delivery mode: auto or steer", "auto")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (threadId: string, messageId: string, opts: QueueSendOptions) => {
          if (opts.mode !== "auto" && opts.mode !== "steer")
            throw new Error("--mode must be auto or steer.");
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.queuedMessages.send({
            threadId,
            queuedMessageId: messageId,
            mode: opts.mode,
          });
          if (outputJson(opts, result)) return;
          console.log(`Queued message ${messageId} sent`);
        },
      ),
    );
  queue
    .command("delete <threadId> <messageId>")
    .description("Delete a queued message")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, messageId: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.queuedMessages.delete({
          threadId,
          queuedMessageId: messageId,
        });
        if (outputJson(opts, result)) return;
        console.log(`Queued message ${messageId} deleted`);
      }),
    );
  queue
    .command("reorder <threadId> <messageId>")
    .description("Move a queued message between adjacent messages")
    .option("--after <id>", "Previous queued message, or omit for the start")
    .option("--before <id>", "Next queued message, or omit for the end")
    .option("--group-boundary <id>", "Current group-boundary message id")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string,
          messageId: string,
          opts: QueueReorderOptions,
        ) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.queuedMessages.reorder({
            threadId,
            queuedMessageId: messageId,
            previousQueuedMessageId: opts.after ?? null,
            nextQueuedMessageId: opts.before ?? null,
            ...(opts.groupBoundary
              ? { groupBoundaryQueuedMessageId: opts.groupBoundary }
              : {}),
          });
          if (outputJson(opts, result)) return;
          console.log(`Queued message ${messageId} reordered`);
        },
      ),
    );
  queue
    .command("group <threadId> <boundaryMessageId>")
    .description("Set the grouped queued-message prefix")
    .requiredOption(
      "--prefix <ids>",
      "Comma-separated expected grouped-prefix ids",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string,
          boundaryMessageId: string,
          opts: QueueGroupOptions,
        ) => {
          const prefix = opts.prefix
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);
          if (prefix.length === 0)
            throw new Error("--prefix must contain at least one message id.");
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.queuedMessages.setGroupBoundary({
            threadId,
            groupBoundaryQueuedMessageId: boundaryMessageId,
            expectedGroupedPrefixQueuedMessageIds: prefix,
          });
          if (outputJson(opts, result)) return;
          console.log(
            `Queued message group boundary set to ${boundaryMessageId}`,
          );
        },
      ),
    );

  const tabs = parent
    .command("tabs")
    .description("Inspect and update persisted thread panel tabs");
  tabs
    .command("show <threadId>")
    .description("Show persisted panel tabs")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).threads.tabs.get({
          threadId,
        });
        if (outputJson(opts, result)) return;
        printHumanJson(result);
      }),
    );
  tabs
    .command("set <threadId>")
    .description("Replace persisted panel tabs with revision checking")
    .requiredOption("--expected-revision <number>", "Current tab revision")
    .requiredOption("--tabs-json <json>", "JSON array of tab descriptors")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string,
          opts: JsonOptions & {
            expectedRevision: string;
            tabsJson: string;
          },
        ) => {
          const request = updateThreadTabsRequestSchema.parse({
            expectedRevision: Number(opts.expectedRevision),
            tabs: JSON.parse(opts.tabsJson),
          });
          const result = await createCliBbSdk(getUrl()).threads.tabs.update({
            threadId,
            ...request,
          });
          if (outputJson(opts, result)) return;
          console.log(
            `Thread ${threadId} tabs updated to revision ${result.revision}`,
          );
        },
      ),
    );
}
