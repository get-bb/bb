import type { Command } from "commander";
import { randomUUID } from "node:crypto";
import {
  threadVisibilitySchema,
  type PermissionMode,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadParentNotifications,
  type ThreadVisibility,
} from "@bb/domain";
import {
  DEFAULT_TURN_RETRY_REASON,
  threadEnvironmentUnavailableApiErrorSchema,
} from "@bb/server-contract";
import { CliExitError } from "../../action.js";
import { arg, flag } from "../../cli-door.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
  type CliCommand,
} from "../../operation-doors.js";
import {
  JSON_FLAG,
  OPTIONAL_THREAD_ID,
  SELF_FLAG,
  SELF_TARGET,
  threadArchiveCommands,
} from "./operation-doors.js";
import { requireTextInput, TEXT_FILE_HELP_SUFFIX } from "../../text-input.js";
import {
  BbHttpError,
  type ThreadRetryResult,
  type ThreadSendResult,
} from "@bb/sdk";
import type { QueuedMessageWaitingOn } from "@bb/domain";
import { parseReasoningLevel } from "../helpers.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../../context-env.js";
import {
  parseParentNotifications,
  parsePermissionMode,
  parseServiceTier,
  SERVICE_TIER_HELP,
  PARENT_NOTIFICATIONS_HELP,
  PERMISSION_MODE_HELP,
  PLAN_HELP,
  buildPromptInputs,
  uploadClientAttachmentInputs,
} from "./helpers.js";
import { SEND_AT_HELP, parseSendAt } from "./send-time.js";

type ThreadTellDeliveryMode = "auto" | "queue" | "steer";

interface ThreadTellInput {
  id: string;
  message: string;
  mode: ThreadTellDeliveryMode;
  model: string | undefined;
  permissionMode: PermissionMode | undefined;
  reasoningLevel: ReasoningLevel | undefined;
  serviceTier: ServiceTier | undefined;
  senderThreadId: string | undefined;
  plan: boolean;
  files: readonly string[];
  images: readonly string[];
  sendAt: number | undefined;
  compactFirst: boolean;
}

type PostThreadMessageResult = ThreadSendResult & {
  mode: ThreadTellDeliveryMode;
};

interface ThreadUpdateBody {
  title?: string;
  sectionId?: string | null;
  parentThreadId?: string | null;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  visibility?: ThreadVisibility;
  parentNotifications?: ThreadParentNotifications;
}

const UPLOAD_HELP =
  "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)";

function threadAction(
  name: string,
  operation:
    | "threads.stop"
    | "threads.compact"
    | "threads.clearContext"
    | "threads.cancelPlan"
    | "threads.clearGoal",
  description: string,
  done: string,
): CliCommand {
  return publicCommand(operation, {
    path: ["thread", name],
    summary: description,
    positionals: OPTIONAL_THREAD_ID,
    options: SELF_TARGET,
    json: (_output, input) => ({ ok: true, threadId: input.id }),
    print: (_output, input) => `Thread ${input.id} ${done}`,
  });
}

function pinCommand(
  name: "pin" | "unpin",
  description: string,
  done: string,
): CliCommand {
  return publicCommand(name === "pin" ? "threads.pin" : "threads.unpin", {
    path: ["thread", name],
    summary: description,
    positionals: OPTIONAL_THREAD_ID,
    options: SELF_TARGET,
    print: (thread) => `Thread ${thread.id} ${done}`,
  });
}

const updateCommand = publicCommand("threads.update", {
  path: ["thread", "update"],
  summary: "Update a thread",
  positionals: OPTIONAL_THREAD_ID,
  options: {
    self: SELF_FLAG,
    json: JSON_FLAG,
    title: flag("--title <title>", "Set the thread title"),
    parentThread: flag("--parent-thread <id>", "Set the parent thread id"),
    clearParentThread: flag(
      "--clear-parent-thread",
      "Clear the parent thread id",
    ),
    section: flag("--section <id>", "Move the thread into a section"),
    clearSection: flag("--clear-section", "Remove the thread from its section"),
    model: flag(
      "--model <model>",
      "Set the sticky model applied on the thread's next turn",
    ),
    reasoningLevel: flag(
      "--reasoning-level <level>",
      "Set the sticky reasoning level applied on the thread's next turn: low, medium, high, xhigh, max (provider-dependent)",
    ),
    visibility: flag(
      "--visibility <visibility>",
      "Thread visibility: visible or hidden",
    ),
    parentNotifications: flag(
      "--parent-notifications <value>",
      PARENT_NOTIFICATIONS_HELP,
    ),
  },
  prepare: ({ positionals, options }, client) => {
    const {
      title,
      parentThread,
      clearParentThread,
      section,
      clearSection,
      model,
    } = options;
    if (parentThread && clearParentThread) {
      throw new Error(
        "Cannot combine --parent-thread with --clear-parent-thread.",
      );
    }
    if (section && clearSection) {
      throw new Error("Cannot combine --section with --clear-section.");
    }
    const reasoningLevel = parseReasoningLevel(options.reasoningLevel);
    const visibility =
      options.visibility === undefined
        ? undefined
        : threadVisibilitySchema.parse(options.visibility);
    const parentNotifications = parseParentNotifications(
      options.parentNotifications,
    );
    if (
      !parentThread &&
      !clearParentThread &&
      !section &&
      !clearSection &&
      !title &&
      !model &&
      !reasoningLevel &&
      !visibility &&
      !parentNotifications
    ) {
      throw new Error(
        "No changes requested. Provide --title, --parent-thread, --clear-parent-thread, --section, --clear-section, --model, --reasoning-level, --visibility, or --parent-notifications.",
      );
    }
    const threadId = client.threadId(positionals.id, options.self);
    const parentThreadId = resolveExplicitIdFlag({
      flagName: "--parent-thread",
      value: parentThread,
    });
    const body: ThreadUpdateBody = {};
    if (title) body.title = title;
    if (parentThreadId) {
      body.parentThreadId = parentThreadId;
    } else if (clearParentThread) {
      body.parentThreadId = null;
    }
    if (section) {
      body.sectionId = resolveExplicitIdFlag({
        flagName: "--section",
        value: section,
      });
    } else if (clearSection) {
      body.sectionId = null;
    }
    if (model) body.model = model;
    if (reasoningLevel) body.reasoningLevel = reasoningLevel;
    if (visibility) body.visibility = visibility;
    if (parentNotifications) body.parentNotifications = parentNotifications;
    return { id: threadId, ...body };
  },
  print: (thread, input) => {
    const lines = [`Thread ${thread.id} updated`];
    if (input.title) lines.push(`Title: ${thread.title ?? "<untitled>"}`);
    if ("parentThreadId" in input) {
      lines.push(
        thread.parentThreadId
          ? `Parent: ${thread.parentThreadId}`
          : "No parent thread",
      );
    }
    if ("sectionId" in input) {
      lines.push(
        thread.sectionId ? `Section: ${thread.sectionId}` : "No section",
      );
    }
    if (input.model) lines.push(`Model: ${input.model}`);
    if (input.reasoningLevel) {
      lines.push(`Reasoning level: ${input.reasoningLevel}`);
    }
    if (input.visibility) lines.push(`Visibility: ${input.visibility}`);
    if (input.parentNotifications) {
      lines.push(`Parent notifications: ${input.parentNotifications}`);
    }
    return lines;
  },
});

const restoreEnvironmentCommand = publicCommand("threads.restoreEnvironment", {
  path: ["thread", "restore-environment"],
  summary:
    "Restore the workspace of a thread whose environment was destroyed, when its environment provider supports restoring",
  positionals: OPTIONAL_THREAD_ID,
  options: SELF_TARGET,
  failure: (input) => `Failed to restore the workspace for thread ${input.id}`,
  print: (thread, input) =>
    `Thread ${input.id} is restoring its workspace (status: ${thread.status})`,
});

const regenerateTitleCommand = publicCommand("threads.regenerateTitle", {
  path: ["thread", "regenerate-title"],
  summary:
    "Replace a thread's title with one generated from its task and latest messages",
  positionals: OPTIONAL_THREAD_ID,
  options: SELF_TARGET,
  failure: (input) => `Failed to regenerate the title of thread ${input.id}`,
  print: (thread) => `Thread ${thread.id} titled "${thread.title}"`,
});

const deleteCommand = clientCommand({
  path: ["thread", "delete"],
  summary: "Delete a thread permanently",
  positionals: { id: arg("<id>") },
  options: {
    yes: flag("--yes", "Skip the confirmation prompt"),
    confirmChildThreads: flag(
      "--confirm-child-threads",
      "Confirm deleting a thread with child threads",
    ),
  },
  declined: ({ positionals }) => ({
    message: `Thread ${positionals.id} deletion cancelled`,
  }),
  async run({ positionals, options }, client) {
    const thread = await client.call("threads.get", { id: positionals.id });
    await client.confirm(
      `Delete thread "${thread.title ?? thread.titleFallback ?? thread.id}" permanently? This cannot be undone.`,
    );
    await client.call("threads.delete", {
      id: positionals.id,
      childThreadsConfirmed: options.confirmChildThreads,
    });
    return null;
  },
  failure: ({ positionals }) => `Failed to delete thread ${positionals.id}`,
  json: (_output, { positionals }) => ({ ok: true, threadId: positionals.id }),
  print: (_output, { positionals }) => `Thread ${positionals.id} deleted`,
});

const editMessageCommand = publicCommand("threads.editMessage", {
  path: ["thread", "edit-message"],
  summary: "Replace an accepted user message and rerun from that point",
  positionals: OPTIONAL_THREAD_ID,
  options: {
    message: flag("--message <text>", "Replacement message text"),
    messageFile: flag(
      "--message-file <path>",
      `Read the replacement message from a file; ${TEXT_FILE_HELP_SUFFIX}`,
    ),
    self: SELF_FLAG,
    expectedRequestSequence: flag(
      "--expected-request-sequence <sequence>",
      "Edit the message at this event sequence (default: the latest editable message)",
    ),
  },
  async prepare({ positionals, options }, client) {
    const threadId = client.threadId(positionals.id, options.self);
    const message = await requireTextInput({
      file: options.messageFile,
      fileLabel: "--message-file",
      inline: options.message,
      inlineLabel: "--message <text>",
    });
    const sequence = options.expectedRequestSequence;
    const expectedRequestSequence =
      sequence === undefined ? undefined : Number(sequence);
    if (
      expectedRequestSequence !== undefined &&
      (!Number.isInteger(expectedRequestSequence) ||
        expectedRequestSequence < 0)
    ) {
      throw new Error(
        "--expected-request-sequence must be a non-negative integer.",
      );
    }
    const senderThreadId = resolveSenderThreadId(threadId);
    return {
      id: threadId,
      operationId: randomUUID(),
      ...(expectedRequestSequence !== undefined
        ? { expectedRequestSequence }
        : {}),
      input: buildPromptInputs({ message }),
      ...(senderThreadId !== undefined ? { senderThreadId } : {}),
    };
  },
  json: (result, input) => ({ threadId: input.id, ...result }),
  print: (_result, input) =>
    `Thread ${input.id} message replaced; workspace changes were kept`,
});

const tellCommand = clientCommand({
  path: ["thread", "tell"],
  summary: "Send a follow-up message to a thread",
  aliases: ["message", "send"],
  positionals: { id: arg("<id>"), message: arg("[message]") },
  options: {
    messageFile: flag(
      "--message-file <path>",
      `Read the message from a file instead of [message]; ${TEXT_FILE_HELP_SUFFIX}`,
    ),
    json: JSON_FLAG,
    model: flag("--model <model>", "Model ID for this message"),
    serviceTier: flag("--service-tier <tier>", SERVICE_TIER_HELP),
    reasoningLevel: flag(
      "--reasoning-level <level>",
      "Reasoning level id the model lists: low, medium, high, xhigh, max, or a provider-specific id",
    ),
    permissionMode: flag("--permission-mode <mode>", PERMISSION_MODE_HELP),
    mode: flag(
      "--mode <mode>",
      "Message mode: steer (default), queue, or auto (steer a live turn, else start one)",
    ),
    sendAt: flag("--send-at <when>", SEND_AT_HELP),
    compactFirst: flag(
      "--compact-first",
      "Compact the idle thread's context first, then send this message when compaction finishes",
    ),
    plan: flag("--plan", PLAN_HELP),
    file: flag("--file <path>", UPLOAD_HELP, { type: "strings", default: [] }),
    image: flag("--image <path>", UPLOAD_HELP, {
      type: "strings",
      default: [],
    }),
  },
  async run({ positionals, options }, client) {
    const id = positionals.id;
    const message = await requireTextInput({
      file: options.messageFile,
      fileLabel: "--message-file",
      inline: positionals.message,
      inlineLabel: "<message>",
    });
    return postThreadMessage(client, {
      id,
      message,
      mode: resolveThreadMessageMode(options.mode),
      model: options.model,
      permissionMode: parsePermissionMode(options.permissionMode),
      reasoningLevel: parseReasoningLevel(options.reasoningLevel),
      serviceTier: parseServiceTier(options.serviceTier),
      senderThreadId: resolveSenderThreadId(id),
      plan: options.plan,
      files: options.file,
      images: options.image,
      sendAt:
        options.sendAt === undefined ? undefined : parseSendAt(options.sendAt),
      compactFirst: options.compactFirst,
    });
  },
  json: (response, { positionals }) => ({
    threadId: positionals.id,
    ...response,
  }),
  print: (response, { positionals, options }) =>
    options.compactFirst
      ? `Thread ${positionals.id} compacting; the message sends when compaction finishes`
      : describeThreadTellOutcome(positionals.id, response),
});

const retryCommand = publicCommand("threads.retry", {
  path: ["thread", "retry"],
  summary: "Retry the failed turn on a thread",
  positionals: OPTIONAL_THREAD_ID,
  options: {
    self: SELF_FLAG,
    turn: flag(
      "--turn <requestId>",
      "Retry this turn request id specifically; fails when it is not the thread's failed turn",
    ),
    sendAt: flag("--send-at <when>", SEND_AT_HELP),
    reason: flag(
      "--reason <text>",
      "Why it is being retried, shown on the queued row",
    ),
  },
  prepare: ({ positionals, options }, client) => ({
    id: client.threadId(positionals.id, options.self),
    turnRequestId: options.turn ?? null,
    sendAt: options.sendAt === undefined ? null : parseSendAt(options.sendAt),
    reason: options.reason ?? DEFAULT_TURN_RETRY_REASON,
  }),
  json: (response, input) => ({ threadId: input.id, ...response }),
  print: (response, input) => describeThreadRetryOutcome(input.id, response),
});

export const threadActionCommands: CliCommand[] = [
  updateCommand,
  restoreEnvironmentCommand,
  pinCommand("pin", "Pin a thread", "pinned"),
  pinCommand("unpin", "Unpin a thread", "unpinned"),
  regenerateTitleCommand,
  deleteCommand,
  editMessageCommand,
  tellCommand,
  retryCommand,
  threadAction(
    "stop",
    "threads.stop",
    "Stop work and release the loaded agent runtime",
    "stopped",
  ),
  threadAction(
    "compact",
    "threads.compact",
    "Request compaction of an idle or errored thread's context",
    "context compaction requested",
  ),
  threadAction(
    "clear",
    "threads.clearContext",
    "Clear model context for an idle or failed thread",
    "context cleared",
  ),
  threadAction(
    "cancel-plan",
    "threads.cancelPlan",
    "Ask the provider to exit the active Plan mode",
    "exited Plan mode",
  ),
  threadAction(
    "clear-goal",
    "threads.clearGoal",
    "Ask the provider to clear the thread's Goal",
    "cleared its Goal",
  ),
];

export function registerActionsCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const [update, ...rest] = threadActionCommands;
  if (update !== undefined) mountCommands(parent, [update], { getUrl });
  mountCommands(parent, threadArchiveCommands, { getUrl });
  mountCommands(parent, rest, { getUrl });
}

async function postThreadMessage(
  client: CliClient,
  args: ThreadTellInput,
): Promise<PostThreadMessageResult> {
  const sdk = client.sdk();
  const input = await uploadClientAttachmentInputs({
    input: buildPromptInputs({
      message: args.message,
      plan: args.plan,
      files: args.files,
      images: args.images,
    }),
    resolveProjectId: async () =>
      (await client.call("threads.get", { id: args.id })).projectId,
    sdk,
  });
  let response: ThreadSendResult;
  try {
    response = await client.call("threads.send", {
      id: args.id,
      input,
      mode:
        args.mode === "steer"
          ? "steer-if-active"
          : args.mode === "auto"
            ? "auto"
            : "queue-if-active",
      ...(args.model ? { model: args.model } : {}),
      ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
      ...(args.reasoningLevel ? { reasoningLevel: args.reasoningLevel } : {}),
      ...(args.serviceTier ? { serviceTier: args.serviceTier } : {}),
      ...(args.senderThreadId ? { senderThreadId: args.senderThreadId } : {}),
      ...(args.sendAt === undefined ? {} : { sendAt: args.sendAt }),
      ...(args.compactFirst ? { compactFirst: true } : {}),
    });
  } catch (error: unknown) {
    throw await withRestoreEnvironmentHint(client, args.id, error);
  }
  return { ...response, mode: args.mode };
}

async function withRestoreEnvironmentHint(
  client: CliClient,
  threadId: string,
  error: unknown,
): Promise<unknown> {
  if (!(error instanceof BbHttpError)) return error;
  const parsed = threadEnvironmentUnavailableApiErrorSchema.safeParse(
    error.body,
  );
  if (!parsed.success || parsed.data.details.reason !== "destroyed") {
    return error;
  }
  const thread = await client
    .call("threads.get", { id: threadId })
    .catch(() => null);
  if (thread === null) return error;
  return new CliExitError(error.message, 1, {
    code: parsed.data.code,
    hint: thread.canRestoreEnvironment
      ? `Its workspace was removed. Restore it with \`bb thread restore-environment ${threadId}\`, then send again.`
      : "Its workspace was removed and its environment provider cannot restore it. Start a new thread to continue.",
  });
}

function describeThreadTellOutcome(
  threadId: string,
  response: PostThreadMessageResult,
): string {
  if (response.delivery === "queued") {
    return `Thread ${threadId} message queued (${describeQueueWait(response.queuedMessage)}); it dispatches when that clears`;
  }
  return response.mode === "steer"
    ? `Thread ${threadId} steered`
    : `Thread ${threadId} updated`;
}

function describeThreadRetryOutcome(
  threadId: string,
  response: ThreadRetryResult,
): string {
  const turn = `turn ${response.turnRequestId} (attempt ${response.attempt})`;
  return response.delivery === "queued"
    ? `Thread ${threadId} retry of ${turn} queued (${describeQueueWait(response)}); it dispatches when that clears`
    : `Thread ${threadId} retrying ${turn}`;
}

export function describeQueueWait(row: {
  sendAt: number | null;
  waitingOn: QueuedMessageWaitingOn | null;
}): string {
  const waitingOn = row.waitingOn ?? { kind: "thread-busy" as const };
  switch (waitingOn.kind) {
    case "time":
      return row.sendAt === null
        ? "scheduled"
        : `scheduled for ${new Date(row.sendAt).toLocaleString()}`;
    case "thread-busy":
      return "waiting for the current turn to finish";
    case "stopping":
      return "sending once the thread finishes stopping";
    case "turn-starting":
      return "waiting for the current turn to start";
    case "provisioning":
      return "waiting for the workspace";
    case "host-offline":
      return `waiting for ${waitingOn.hostName} to reconnect`;
    case "interaction":
      return "waiting for a pending interaction";
    case "app-update":
      return "sending after bb restarts to update";
    case "plugin":
      return `${waitingOn.pluginId}: ${waitingOn.reason}`;
    case "superseded":
      return "not sent: a newer message was sent after it";
  }
}

function resolveSenderThreadId(targetThreadId: string): string | undefined {
  const senderThreadId = resolveContextThreadId();
  if (!senderThreadId || senderThreadId === targetThreadId) {
    return undefined;
  }
  return senderThreadId;
}

function resolveThreadMessageMode(
  value: string | undefined,
): ThreadTellDeliveryMode {
  if (value === undefined) return "steer";
  const normalized = value.trim().toLowerCase();
  if (normalized === "steer") return "steer";
  if (normalized === "steer-if-active") return "steer";
  if (normalized === "queue") return "queue";
  if (normalized === "queue-if-active") return "queue";
  if (normalized === "auto") return "auto";
  throw new Error(
    `Invalid message mode '${value}'. Expected 'queue', 'steer', or 'auto'.`,
  );
}
