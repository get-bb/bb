import type { Command } from "commander";
import { updateThreadTabsRequestSchema } from "@bb/server-contract";
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
import { arg, flag } from "../../cli-door.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
  type CliCommand,
} from "../../operation-doors.js";
import {
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

const MESSAGE_FILE_OPTION = {
  messageFile: flag(
    "--message-file <path>",
    `Read the message from a file instead of [message]; ${TEXT_FILE_HELP_SUFFIX}`,
  ),
};

const FILE_OPTIONS = {
  file: flag("--file <path>", UPLOAD_HELP, { type: "strings", default: [] }),
  image: flag("--image <path>", UPLOAD_HELP, { type: "strings", default: [] }),
};

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
  positionals: { id: arg("<id>") },
  confirm: (input) => `Delete thread section ${input.id}?`,
  print: (result) =>
    `Thread section ${result.id} deleted; ${result.updatedThreadCount} thread(s) unsectioned`,
});

const searchCommand = publicCommand("threads.search", {
  path: ["thread", "search"],
  summary: "Search threads and messages",
  positionals: { query: arg("<query>") },
  options: {
    limit: flag(
      "--limit <count>",
      `Maximum results per group (1-${THREAD_SEARCH_LIMIT_PER_GROUP_MAX})`,
    ),
  },
  prepare: ({ positionals, options }) => {
    const limitPerGroup = parsePositiveInteger(
      options.limit,
      "--limit",
      THREAD_SEARCH_LIMIT_PER_GROUP_MAX,
    );
    return {
      query: positionals.query,
      ...(limitPerGroup === undefined ? {} : { limitPerGroup }),
    };
  },
  print: (result) => humanJson(result),
});

const historyCommand = publicCommand("threads.promptHistory", {
  path: ["thread", "history"],
  summary: "List a thread's prompt history",
  positionals: { id: arg("<id>") },
  options: { limit: flag("--limit <count>", "Maximum history entries") },
  prepare: ({ positionals, options }) => {
    const limit = parsePositiveInteger(options.limit, "--limit");
    return {
      id: positionals.id,
      ...(limit === undefined ? {} : { limit }),
    };
  },
  print: (result) => humanJson(result),
});

const reorderPinnedCommand = publicCommand("threads.pinOrder", {
  path: ["thread", "reorder-pinned"],
  summary: "Move a pinned thread between adjacent pinned threads",
  positionals: { id: arg("<id>") },
  options: {
    after: flag(
      "--after <id>",
      "Previous pinned thread, or omit for the start",
    ),
    before: flag("--before <id>", "Next pinned thread, or omit for the end"),
  },
  prepare: ({ positionals, options }) => ({
    id: positionals.id,
    previousThreadId: options.after ?? null,
    nextThreadId: options.before ?? null,
  }),
  print: (_result, input) => `Pinned thread ${input.id} reordered`,
});

const queueListCommand = clientCommand({
  path: ["thread", "queue", "list"],
  summary: "List queued messages; omit the thread to list every one",
  positionals: { threadId: arg("[threadId]") },
  options: {
    waitHolder: flag(
      "--wait-holder <holder>",
      "Filter to rows one plugin is holding: plugin:<plugin-id>",
    ),
  },
  run: ({ positionals, options }, client) => {
    const waitHolder = options.waitHolder
      ? parseWaitHolder(options.waitHolder)
      : undefined;
    return positionals.threadId === undefined
      ? client.call("queue.list", {
          ...(waitHolder === undefined ? {} : { waitHolder }),
        })
      : client.call("threads.queuedMessages", { id: positionals.threadId });
  },
  print: (result) => {
    if (result.length === 0) return "No queued messages found";
    return printQueueTable(result);
  },
});

const queueCreateCommand = clientCommand({
  path: ["thread", "queue", "create"],
  summary: "Create a queued message with text and attachments",
  positionals: { threadId: arg("<threadId>"), message: arg("[message]") },
  options: {
    model: flag("--model <model>", "Model override for the queued message"),
    ...MESSAGE_FILE_OPTION,
    ...FILE_OPTIONS,
  },
  async run({ positionals, options }, client) {
    const message = await requireTextInput({
      file: options.messageFile,
      fileLabel: "--message-file",
      inline: positionals.message,
      inlineLabel: "<message>",
    });
    const prompt = await uploadQueuedInput(
      client,
      positionals.threadId,
      message,
      options.file,
      options.image,
    );
    return client.call("threads.createQueuedMessage", {
      id: positionals.threadId,
      input: prompt,
      ...(options.model ? { model: options.model } : {}),
    });
  },
  print: (result, { positionals }) =>
    `Queued message ${result.id} created for thread ${positionals.threadId}`,
});

function queueSendAt(options: {
  sendAt: string | undefined;
  clearSendAt: boolean;
}): number | null | undefined {
  if (options.sendAt !== undefined && options.clearSendAt) {
    throw new Error("Provide only one of --send-at or --clear-send-at.");
  }
  if (options.sendAt !== undefined) return parseSendAt(options.sendAt);
  return options.clearSendAt ? null : undefined;
}

const queueUpdateCommand = clientCommand({
  path: ["thread", "queue", "update"],
  summary:
    "Update a queued message's text, send time, or execution options in place",
  positionals: {
    threadId: arg("<threadId>"),
    messageId: arg("<messageId>"),
    message: arg("[message]"),
  },
  options: {
    ...MESSAGE_FILE_OPTION,
    ...FILE_OPTIONS,
    sendAt: flag(
      "--send-at <when>",
      "Change when it sends: an ISO 8601 timestamp (2026-08-25T09:00) or a duration from now (30s, 10m, 2h, 7d); the message text is optional",
    ),
    clearSendAt: flag(
      "--clear-send-at",
      "Remove its send time so it goes once nothing else holds it; the message text is optional",
    ),
    model: flag(
      "--model <model>",
      "Model ID to send it with; the message text is optional",
    ),
    reasoningLevel: flag(
      "--reasoning-level <level>",
      "Reasoning level id the model lists: low, medium, high, xhigh, max, or a provider-specific id",
    ),
    permissionMode: flag("--permission-mode <mode>", PERMISSION_MODE_HELP),
    serviceTier: flag("--service-tier <tier>", SERVICE_TIER_HELP),
  },
  async run({ positionals, options }, client) {
    const { threadId, messageId } = positionals;
    const sendAt = queueSendAt(options);
    const model = options.model;
    const permissionMode = parsePermissionMode(options.permissionMode);
    const reasoningLevel = parseReasoningLevel(options.reasoningLevel);
    const serviceTier = parseServiceTier(options.serviceTier);
    const changesExecution =
      model !== undefined ||
      permissionMode !== undefined ||
      reasoningLevel !== undefined ||
      serviceTier !== undefined;
    const textInput = {
      file: options.messageFile,
      fileLabel: "--message-file",
      inline: positionals.message,
      inlineLabel: "<message>",
    };
    const attachesFiles = options.file.length > 0 || options.image.length > 0;
    const message =
      (sendAt === undefined && !changesExecution) || attachesFiles
        ? await requireTextInput(textInput)
        : await resolveTextInput(textInput);
    const existing = (
      await client.call("threads.queuedMessages", { id: threadId })
    ).find((queuedMessage) => queuedMessage.id === messageId);
    if (!existing) {
      throw new Error(
        `Queued message ${messageId} not found on thread ${threadId}.`,
      );
    }
    const prompt =
      message === undefined
        ? undefined
        : await uploadQueuedInput(
            client,
            threadId,
            message,
            options.file,
            options.image,
          );
    return client.call("threads.updateQueuedMessage", {
      id: threadId,
      queuedMessageId: messageId,
      expectedUpdatedAt: existing.updatedAt,
      ...(prompt === undefined ? {} : { input: prompt }),
      ...(sendAt === undefined ? {} : { sendAt }),
      ...(model === undefined ? {} : { model }),
      ...(permissionMode === undefined ? {} : { permissionMode }),
      ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
      ...(serviceTier === undefined ? {} : { serviceTier }),
    });
  },
  print: (result, { positionals, options }) =>
    options.sendAt === undefined && !options.clearSendAt
      ? `Queued message ${positionals.messageId} updated`
      : result.sendAt === null
        ? `Queued message ${positionals.messageId} updated; it has no send time`
        : `Queued message ${positionals.messageId} updated; sends at ${new Date(result.sendAt).toLocaleString()}`,
});

const queueSendCommand = publicCommand("threads.sendQueuedMessage", {
  path: ["thread", "queue", "send"],
  summary: "Send and remove a queued message",
  positionals: { threadId: arg("<threadId>"), messageId: arg("<messageId>") },
  options: {
    mode: flag("--mode <mode>", "Delivery mode: auto or steer", {
      default: "auto",
    }),
  },
  prepare: ({ positionals, options }) => {
    const mode = options.mode;
    if (mode !== "auto" && mode !== "steer") {
      throw new Error("--mode must be auto or steer.");
    }
    return {
      id: positionals.threadId,
      queuedMessageId: positionals.messageId,
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
  positionals: {
    id: arg("<threadId>"),
    queuedMessageId: arg("<messageId>"),
  },
  print: (_result, input) => `Queued message ${input.queuedMessageId} deleted`,
});

const queueReorderCommand = publicCommand("threads.reorderQueuedMessage", {
  path: ["thread", "queue", "reorder"],
  summary: "Move a queued message between adjacent messages",
  positionals: { threadId: arg("<threadId>"), messageId: arg("<messageId>") },
  options: {
    after: flag(
      "--after <id>",
      "Previous queued message, or omit for the start",
    ),
    before: flag("--before <id>", "Next queued message, or omit for the end"),
    groupBoundary: flag(
      "--group-boundary <id>",
      "Current group-boundary message id",
    ),
  },
  prepare: ({ positionals, options }) => ({
    id: positionals.threadId,
    queuedMessageId: positionals.messageId,
    previousQueuedMessageId: options.after ?? null,
    nextQueuedMessageId: options.before ?? null,
    ...(options.groupBoundary
      ? { groupBoundaryQueuedMessageId: options.groupBoundary }
      : {}),
  }),
  print: (_result, input) =>
    `Queued message ${input.queuedMessageId} reordered`,
});

const queueGroupCommand = publicCommand(
  "threads.setQueuedMessageGroupBoundary",
  {
    path: ["thread", "queue", "group"],
    summary: "Set the grouped queued-message prefix",
    positionals: {
      threadId: arg("<threadId>"),
      boundaryMessageId: arg("<boundaryMessageId>"),
    },
    options: {
      prefix: flag(
        "--prefix <ids>",
        "Comma-separated expected grouped-prefix ids",
        { required: true },
      ),
    },
    prepare: ({ positionals, options }) => {
      const prefix = options.prefix
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (prefix.length === 0) {
        throw new Error("--prefix must contain at least one message id.");
      }
      return {
        id: positionals.threadId,
        groupBoundaryQueuedMessageId: positionals.boundaryMessageId,
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
  positionals: { id: arg("<threadId>") },
  print: (result) => humanJson(result),
});

const tabsSetCommand = publicCommand("threads.updateTabs", {
  path: ["thread", "tabs", "set"],
  summary: "Replace persisted panel tabs with revision checking",
  positionals: { threadId: arg("<threadId>") },
  options: {
    expectedRevision: flag(
      "--expected-revision <number>",
      "Current tab revision",
      { required: true },
    ),
    tabsJson: flag("--tabs-json <json>", "JSON array of tab descriptors", {
      required: true,
    }),
  },
  prepare: ({ positionals, options }) => {
    const request = updateThreadTabsRequestSchema.parse({
      expectedRevision: Number(options.expectedRevision),
      tabs: JSON.parse(options.tabsJson),
    });
    return { id: positionals.threadId, ...request };
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
