import { flag } from "@bb/operations";
import type { Command } from "commander";
import {
  updateThreadTabsRequestSchema,
  type PublicOperationOutput,
} from "@bb/server-contract";
import {
  RESTART_RESUME_RETRY_REASON,
  queuedMessageWaitHolderSchema,
  type PromptInput,
  type QueuedMessageWaitHolder,
} from "@bb/domain";
import type { ThreadQueuedMessagesResult } from "@bb/sdk";
import {
  columnWidths,
  printBorderlessTable,
  truncateCell,
} from "../../table.js";
import { describeQueueWait } from "./actions.js";
import { formatQueueSendCountdown, parseSendAt } from "./send-time.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
  type CliCommand,
} from "../../operation-doors.js";
import {
  optionalString,
  stringList,
  threadSectionCommands,
  threadReadCommands,
} from "./operation-doors.js";
import {
  requireTextInput,
  resolveTextInput,
  TEXT_FILE_HELP_SUFFIX,
} from "../../text-input.js";
import { parseReasoningLevel } from "../helpers.js";
import {
  buildPromptInputs,
  parsePermissionMode,
  parseServiceTier,
  PERMISSION_MODE_HELP,
  SERVICE_TIER_HELP,
  uploadClientAttachmentInputs,
} from "./helpers.js";

const THREAD_SEARCH_LIMIT_PER_GROUP_MAX = 50;

function parsePositiveInteger(
  value: string | undefined,
  flag: string,
  maximum?: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value) || Number(value) < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  if (maximum !== undefined && Number(value) > maximum) {
    throw new Error(`${flag} must be at most ${maximum}.`);
  }
  return value;
}

function humanJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const MAX_QUEUE_TEXT_WIDTH = 40;

function printQueueTable(rows: ThreadQueuedMessagesResult): null {
  const now = Date.now();
  const table = rows.map((row) => [
    row.id,
    row.threadId,
    row.initiator === "user"
      ? ""
      : row.initiator === "system"
        ? "System"
        : (row.senderThreadId ?? "Agent"),
    truncateCell(
      row.payload.kind === "retry" &&
        row.payload.reason === RESTART_RESUME_RETRY_REASON
        ? `Resume after ${RESTART_RESUME_RETRY_REASON}`
        : queuedMessagePreview(row.content),
      MAX_QUEUE_TEXT_WIDTH,
    ),
    row.state,
    truncateCell(
      row.failureReason === null
        ? describeQueueWait(row)
        : `Failed: ${row.failureReason}`,
      MAX_QUEUE_TEXT_WIDTH,
    ),
    formatQueueSendCountdown(row.sendAt, now),
  ]);
  printBorderlessTable(
    {
      head: [
        "ID",
        "Thread",
        "Sender",
        "Message",
        "State",
        "Waiting on",
        "Send at",
      ],
      colWidths: columnWidths(table, [2, 6, 6, 7, 5, 10, 7]),
    },
    table,
  );
  for (const row of rows) {
    if (row.failureReason === null) continue;
    console.log(`Failed ${row.id}: ${row.failureReason}`);
    console.log(`Retry: bb thread queue send ${row.threadId} ${row.id}`);
  }
  return null;
}

function queuedMessagePreview(content: PromptInput[]): string {
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ");
  return text.trim() === "" ? "(no text)" : text;
}

function parseWaitHolder(value: string): QueuedMessageWaitHolder {
  const parsed = queuedMessageWaitHolderSchema.safeParse(value.trim());
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid --wait-holder value '${value}'. Expected 'plugin:<plugin-id>'.`,
  );
}

const UPLOAD_HELP =
  "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)";

const MESSAGE_FILE_OPTION = flag(
  "--message-file <path>",
  `Read the message from a file instead of [message]; ${TEXT_FILE_HELP_SUFFIX}`,
);

const FILE_OPTIONS = [
  flag("--file <path>", UPLOAD_HELP, { type: "strings", default: [] }),
  flag("--image <path>", UPLOAD_HELP, { type: "strings", default: [] }),
] as const;

interface QueueListInput {
  threadId?: string;
  waitHolder?: QueuedMessageWaitHolder;
}

interface QueueCreateInput {
  threadId: string;
  message: string;
  files: string[];
  images: string[];
  model?: string;
}

interface QueueUpdateInput {
  threadId: string;
  messageId: string;
  inlineMessage?: string;
  messageFile?: string;
  files: string[];
  images: string[];
  sendAt?: number | null;
  model?: string;
  permissionMode?: ReturnType<typeof parsePermissionMode>;
  reasoningLevel?: ReturnType<typeof parseReasoningLevel>;
  serviceTier?: ReturnType<typeof parseServiceTier>;
}

async function uploadQueuedInput(
  client: CliClient,
  threadId: string,
  message: string,
  files: readonly string[],
  images: readonly string[],
): Promise<PromptInput[]> {
  return uploadClientAttachmentInputs({
    input: buildPromptInputs({ message, files, images }),
    resolveProjectId: async () =>
      (await client.call("threads.get", { id: threadId })).projectId,
    sdk: client.sdk(),
  });
}

const sectionDeleteCommand = publicCommand("threadSections.delete", {
  path: ["thread", "section", "delete"],
  summary: "Delete a thread section and remove its thread assignments",
  positionals: [{ name: "id", field: "id" }],
  confirm: (input) => `Delete thread section ${input.id}?`,
  print: (result) =>
    `Thread section ${result.id} deleted; ${result.updatedThreadCount} thread(s) unsectioned`,
});

const searchCommand = publicCommand("threads.search", {
  path: ["thread", "search"],
  summary: "Search threads and messages",
  positionals: [{ name: "query" }],
  options: [
    flag(
      "--limit <count>",
      `Maximum results per group (1-${THREAD_SEARCH_LIMIT_PER_GROUP_MAX})`,
    ),
  ],
  prepare: ({ positionals, options }) => {
    const limitPerGroup = parsePositiveInteger(
      optionalString(options.limit),
      "--limit",
      THREAD_SEARCH_LIMIT_PER_GROUP_MAX,
    );
    return {
      query: optionalString(positionals.query) ?? "",
      ...(limitPerGroup === undefined ? {} : { limitPerGroup }),
    };
  },
  print: (result) => humanJson(result),
});

const historyCommand = publicCommand("threads.promptHistory", {
  path: ["thread", "history"],
  summary: "List a thread's prompt history",
  positionals: [{ name: "id" }],
  options: [flag("--limit <count>", "Maximum history entries")],
  prepare: ({ positionals, options }) => {
    const limit = parsePositiveInteger(
      optionalString(options.limit),
      "--limit",
    );
    return {
      id: optionalString(positionals.id) ?? "",
      ...(limit === undefined ? {} : { limit }),
    };
  },
  print: (result) => humanJson(result),
});

const reorderPinnedCommand = publicCommand("threads.pinOrder", {
  path: ["thread", "reorder-pinned"],
  summary: "Move a pinned thread between adjacent pinned threads",
  positionals: [{ name: "id" }],
  options: [
    flag("--after <id>", "Previous pinned thread, or omit for the start"),
    flag("--before <id>", "Next pinned thread, or omit for the end"),
  ],
  prepare: ({ positionals, options }) => ({
    id: optionalString(positionals.id) ?? "",
    previousThreadId: optionalString(options.after) ?? null,
    nextThreadId: optionalString(options.before) ?? null,
  }),
  print: (_result, input) => `Pinned thread ${input.id} reordered`,
});

const queueListCommand = clientCommand<
  QueueListInput,
  ThreadQueuedMessagesResult
>({
  name: "cli.thread.queue.list",
  kind: "read",
  description:
    "List one thread's queued messages (threads.queuedMessages) or every queued message (queue.list)",
  door: {
    path: ["thread", "queue", "list"],
    summary: "List queued messages; omit the thread to list every one",
    positionals: [{ name: "threadId", required: false }],
    options: [
      flag(
        "--wait-holder <holder>",
        "Filter to rows one plugin is holding: plugin:<plugin-id>",
      ),
    ],
    prepare: ({ positionals, options }) => {
      const threadId = optionalString(positionals.threadId);
      const waitHolder = optionalString(options["wait-holder"]);
      return {
        ...(threadId === undefined ? {} : { threadId }),
        ...(waitHolder ? { waitHolder: parseWaitHolder(waitHolder) } : {}),
      };
    },
    run: (input, client) =>
      input.threadId === undefined
        ? client.call("queue.list", {
            ...(input.waitHolder === undefined
              ? {}
              : { waitHolder: input.waitHolder }),
          })
        : client.call("threads.queuedMessages", { id: input.threadId }),
    print: (result) => {
      if (result.length === 0) return "No queued messages found";
      return printQueueTable(result);
    },
  },
});

const queueCreateCommand = clientCommand<
  QueueCreateInput,
  PublicOperationOutput<"threads.createQueuedMessage">
>({
  name: "cli.thread.queue.create",
  kind: "write",
  description:
    "Upload local attachments, then queue a message (projects.uploadAttachment, threads.createQueuedMessage)",
  door: {
    path: ["thread", "queue", "create"],
    summary: "Create a queued message with text and attachments",
    positionals: [{ name: "threadId" }, { name: "message", required: false }],
    options: [
      flag("--model <model>", "Model override for the queued message"),
      MESSAGE_FILE_OPTION,
      ...FILE_OPTIONS,
    ],
    async prepare({ positionals, options }) {
      const message = await requireTextInput({
        file: optionalString(options["message-file"]),
        fileLabel: "--message-file",
        inline: optionalString(positionals.message),
        inlineLabel: "<message>",
      });
      const model = optionalString(options.model);
      return {
        threadId: optionalString(positionals.threadId) ?? "",
        message,
        files: stringList(options.file),
        images: stringList(options.image),
        ...(model ? { model } : {}),
      };
    },
    async run(input, client) {
      const prompt = await uploadQueuedInput(
        client,
        input.threadId,
        input.message,
        input.files,
        input.images,
      );
      return client.call("threads.createQueuedMessage", {
        id: input.threadId,
        input: prompt,
        ...(input.model ? { model: input.model } : {}),
      });
    },
    print: (result, input) =>
      `Queued message ${result.id} created for thread ${input.threadId}`,
  },
});

const queueUpdateCommand = clientCommand<
  QueueUpdateInput,
  PublicOperationOutput<"threads.updateQueuedMessage">
>({
  name: "cli.thread.queue.update",
  kind: "write",
  description:
    "Read the queued row for its revision, upload local attachments, then update it (threads.queuedMessages, projects.uploadAttachment, threads.updateQueuedMessage)",
  door: {
    path: ["thread", "queue", "update"],
    summary:
      "Update a queued message's text, send time, or execution options in place",
    positionals: [
      { name: "threadId" },
      { name: "messageId" },
      { name: "message", required: false },
    ],
    options: [
      MESSAGE_FILE_OPTION,
      ...FILE_OPTIONS,
      flag(
        "--send-at <when>",
        "Change when it sends: an ISO 8601 timestamp (2026-08-25T09:00) or a duration from now (30s, 10m, 2h, 7d); the message text is optional",
      ),
      flag(
        "--clear-send-at",
        "Remove its send time so it goes once nothing else holds it; the message text is optional",
      ),
      flag(
        "--model <model>",
        "Model ID to send it with; the message text is optional",
      ),
      flag(
        "--reasoning-level <level>",
        "Reasoning level id the model lists: low, medium, high, xhigh, max, or a provider-specific id",
      ),
      flag("--permission-mode <mode>", PERMISSION_MODE_HELP),
      flag("--service-tier <tier>", SERVICE_TIER_HELP),
    ],
    prepare: ({ positionals, options }) => {
      const sendAtValue = optionalString(options["send-at"]);
      const clearSendAt = options["clear-send-at"] === true;
      if (sendAtValue !== undefined && clearSendAt) {
        throw new Error("Provide only one of --send-at or --clear-send-at.");
      }
      const sendAt =
        sendAtValue !== undefined
          ? parseSendAt(sendAtValue)
          : clearSendAt
            ? null
            : undefined;
      const model = optionalString(options.model);
      const permissionMode = parsePermissionMode(
        optionalString(options["permission-mode"]),
      );
      const reasoningLevel = parseReasoningLevel(
        optionalString(options["reasoning-level"]),
      );
      const serviceTier = parseServiceTier(
        optionalString(options["service-tier"]),
      );
      const inlineMessage = optionalString(positionals.message);
      const messageFile = optionalString(options["message-file"]);
      return {
        threadId: optionalString(positionals.threadId) ?? "",
        messageId: optionalString(positionals.messageId) ?? "",
        ...(inlineMessage === undefined ? {} : { inlineMessage }),
        ...(messageFile === undefined ? {} : { messageFile }),
        files: stringList(options.file),
        images: stringList(options.image),
        ...(sendAt === undefined ? {} : { sendAt }),
        ...(model === undefined ? {} : { model }),
        ...(permissionMode === undefined ? {} : { permissionMode }),
        ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
        ...(serviceTier === undefined ? {} : { serviceTier }),
      };
    },
    async run(input, client) {
      const changesExecution =
        input.model !== undefined ||
        input.permissionMode !== undefined ||
        input.reasoningLevel !== undefined ||
        input.serviceTier !== undefined;
      const textInput = {
        file: input.messageFile,
        fileLabel: "--message-file",
        inline: input.inlineMessage,
        inlineLabel: "<message>",
      };
      const attachesFiles = input.files.length > 0 || input.images.length > 0;
      const message =
        (input.sendAt === undefined && !changesExecution) || attachesFiles
          ? await requireTextInput(textInput)
          : await resolveTextInput(textInput);
      const existing = (
        await client.call("threads.queuedMessages", { id: input.threadId })
      ).find((queuedMessage) => queuedMessage.id === input.messageId);
      if (!existing) {
        throw new Error(
          `Queued message ${input.messageId} not found on thread ${input.threadId}.`,
        );
      }
      const prompt =
        message === undefined
          ? undefined
          : await uploadQueuedInput(
              client,
              input.threadId,
              message,
              input.files,
              input.images,
            );
      return client.call("threads.updateQueuedMessage", {
        id: input.threadId,
        queuedMessageId: input.messageId,
        expectedUpdatedAt: existing.updatedAt,
        ...(prompt === undefined ? {} : { input: prompt }),
        ...(input.sendAt === undefined ? {} : { sendAt: input.sendAt }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.permissionMode === undefined
          ? {}
          : { permissionMode: input.permissionMode }),
        ...(input.reasoningLevel === undefined
          ? {}
          : { reasoningLevel: input.reasoningLevel }),
        ...(input.serviceTier === undefined
          ? {}
          : { serviceTier: input.serviceTier }),
      });
    },
    print: (result, input) =>
      input.sendAt === undefined
        ? `Queued message ${input.messageId} updated`
        : result.sendAt === null
          ? `Queued message ${input.messageId} updated; it has no send time`
          : `Queued message ${input.messageId} updated; sends at ${new Date(result.sendAt).toLocaleString()}`,
  },
});

const queueSendCommand = publicCommand("threads.sendQueuedMessage", {
  path: ["thread", "queue", "send"],
  summary: "Send and remove a queued message",
  positionals: [{ name: "threadId" }, { name: "messageId" }],
  options: [
    flag("--mode <mode>", "Delivery mode: auto or steer", { default: "auto" }),
  ],
  prepare: ({ positionals, options }) => {
    const mode = options.mode;
    if (mode !== "auto" && mode !== "steer") {
      throw new Error("--mode must be auto or steer.");
    }
    return {
      id: optionalString(positionals.threadId) ?? "",
      queuedMessageId: optionalString(positionals.messageId) ?? "",
      mode,
    };
  },
  print: (result, input) =>
    result.delivery === "queued"
      ? `Queued message ${input.queuedMessageId} is still queued (${describeQueueWait(result.queuedMessage)})`
      : `Queued message ${input.queuedMessageId} sent`,
});

const queueDeleteCommand = publicCommand("threads.deleteQueuedMessage", {
  path: ["thread", "queue", "delete"],
  summary: "Delete a queued message",
  positionals: [
    { name: "threadId", field: "id" },
    { name: "messageId", field: "queuedMessageId" },
  ],
  print: (_result, input) => `Queued message ${input.queuedMessageId} deleted`,
});

const queueReorderCommand = publicCommand("threads.reorderQueuedMessage", {
  path: ["thread", "queue", "reorder"],
  summary: "Move a queued message between adjacent messages",
  positionals: [{ name: "threadId" }, { name: "messageId" }],
  options: [
    flag("--after <id>", "Previous queued message, or omit for the start"),
    flag("--before <id>", "Next queued message, or omit for the end"),
    flag("--group-boundary <id>", "Current group-boundary message id"),
  ],
  prepare: ({ positionals, options }) => {
    const groupBoundary = optionalString(options["group-boundary"]);
    return {
      id: optionalString(positionals.threadId) ?? "",
      queuedMessageId: optionalString(positionals.messageId) ?? "",
      previousQueuedMessageId: optionalString(options.after) ?? null,
      nextQueuedMessageId: optionalString(options.before) ?? null,
      ...(groupBoundary ? { groupBoundaryQueuedMessageId: groupBoundary } : {}),
    };
  },
  print: (_result, input) =>
    `Queued message ${input.queuedMessageId} reordered`,
});

const queueGroupCommand = publicCommand(
  "threads.setQueuedMessageGroupBoundary",
  {
    path: ["thread", "queue", "group"],
    summary: "Set the grouped queued-message prefix",
    positionals: [{ name: "threadId" }, { name: "boundaryMessageId" }],
    options: [
      flag("--prefix <ids>", "Comma-separated expected grouped-prefix ids", {
        required: true,
      }),
    ],
    prepare: ({ positionals, options }) => {
      const prefix = (optionalString(options.prefix) ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (prefix.length === 0) {
        throw new Error("--prefix must contain at least one message id.");
      }
      return {
        id: optionalString(positionals.threadId) ?? "",
        groupBoundaryQueuedMessageId:
          optionalString(positionals.boundaryMessageId) ?? "",
        expectedGroupedPrefixQueuedMessageIds: prefix,
      };
    },
    print: (_result, input) =>
      `Queued message group boundary set to ${input.groupBoundaryQueuedMessageId}`,
  },
);

const tabsShowCommand = publicCommand("threads.tabs", {
  path: ["thread", "tabs", "show"],
  summary: "Show persisted panel tabs",
  positionals: [{ name: "threadId", field: "id" }],
  print: (result) => humanJson(result),
});

const tabsSetCommand = publicCommand("threads.updateTabs", {
  path: ["thread", "tabs", "set"],
  summary: "Replace persisted panel tabs with revision checking",
  positionals: [{ name: "threadId" }],
  options: [
    flag("--expected-revision <number>", "Current tab revision", {
      required: true,
    }),
    flag("--tabs-json <json>", "JSON array of tab descriptors", {
      required: true,
    }),
  ],
  prepare: ({ positionals, options }) => {
    const request = updateThreadTabsRequestSchema.parse({
      expectedRevision: Number(optionalString(options["expected-revision"])),
      tabs: JSON.parse(optionalString(options["tabs-json"]) ?? ""),
    });
    return { id: optionalString(positionals.threadId) ?? "", ...request };
  },
  print: (result, input) =>
    `Thread ${input.id} tabs updated to revision ${result.revision}`,
});

export const threadOrganizationCommands: CliCommand[] = [
  sectionDeleteCommand,
  searchCommand,
  historyCommand,
  reorderPinnedCommand,
  queueListCommand,
  queueCreateCommand,
  queueUpdateCommand,
  queueSendCommand,
  queueDeleteCommand,
  queueReorderCommand,
  queueGroupCommand,
  tabsShowCommand,
  tabsSetCommand,
];

export function registerOrganizationCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const deps = { getUrl };
  const section = parent
    .command("section")
    .description("Manage thread sections");
  mountCommands(
    section,
    [...threadSectionCommands, sectionDeleteCommand],
    deps,
  );
  mountCommands(parent, [searchCommand, historyCommand], deps);
  mountCommands(parent, threadReadCommands, deps);
  mountCommands(parent, [reorderPinnedCommand], deps);
  const queue = parent
    .command("queue")
    .description("Manage queued thread messages");
  mountCommands(
    queue,
    [
      queueListCommand,
      queueCreateCommand,
      queueUpdateCommand,
      queueSendCommand,
      queueDeleteCommand,
      queueReorderCommand,
      queueGroupCommand,
    ],
    deps,
  );
  const tabs = parent
    .command("tabs")
    .description("Inspect and update persisted thread panel tabs");
  mountCommands(tabs, [tabsShowCommand, tabsSetCommand], deps);
}
