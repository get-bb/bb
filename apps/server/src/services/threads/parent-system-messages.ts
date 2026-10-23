import { getHost, getThread } from "@bb/db";
import type {
  PromptInput,
  PromptMentionResource,
  QueuedMessageSystemNotice,
  PromptTextMention,
  SystemMessageKind,
  SystemMessageSubject,
} from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requireThreadEnvironment } from "../lib/entity-lookup.js";
import { buildExecutionOptions } from "./thread-commands.js";
import { isHostUnavailableApiError } from "../hosts/online-rpc.js";
import { ThreadContextClearInProgressError } from "./thread-context-mutation-guard.js";
import { requestQueuedMessageDispatch } from "./queued-message-dispatch.js";
import { attemptDispatch } from "./dispatch-attempt.js";
import { recordQueuedMessageWait } from "./queue-waits.js";

export interface ParentSystemMessageTaxonomy {
  systemMessageKind: SystemMessageKind;
  systemMessageSubject: SystemMessageSubject | null;
}

interface QueueParentSystemMessageArgs extends ParentSystemMessageTaxonomy {
  input: PromptInput[];
  parentThreadId: string;
}

export interface ParentSystemRenderedMention {
  resource: PromptMentionResource;
  serializedText: string;
}

export interface ParentSystemThreadMentionSource {
  id: string;
  projectId: string;
  title: string | null;
}

interface ParentSystemTextSegment {
  kind: "text";
  text: string;
}

interface ParentSystemMentionSegment {
  kind: "mention";
  mention: ParentSystemRenderedMention;
}

export type ParentSystemInputSegment =
  | ParentSystemTextSegment
  | ParentSystemMentionSegment;

interface BuildParentSystemInputFromSegmentsArgs {
  segments: readonly ParentSystemInputSegment[];
}

interface BuildParentSystemInputFromTemplateSlotArgs {
  renderedText: string;
  segments: readonly ParentSystemInputSegment[];
  slot: string;
}

interface BuildParentSystemThreadMentionArgs {
  thread: ParentSystemThreadMentionSource;
}

interface RenderedParentSystemSlotParts {
  prefix: string;
  suffix: string;
}

function splitRenderedParentSystemSlot(
  args: BuildParentSystemInputFromTemplateSlotArgs,
): RenderedParentSystemSlotParts {
  const start = args.renderedText.indexOf(args.slot);
  if (start === -1) {
    throw new Error("Parent system template slot was not found in message");
  }
  const next = args.renderedText.indexOf(args.slot, start + args.slot.length);
  if (next !== -1) {
    throw new Error("Parent system template slot must be unique in message");
  }

  return {
    prefix: args.renderedText.slice(0, start),
    suffix: args.renderedText.slice(start + args.slot.length),
  };
}

function buildParentSystemInputFromSegments(
  args: BuildParentSystemInputFromSegmentsArgs,
): PromptInput[] {
  let text = "";
  const mentions: PromptTextMention[] = [];

  for (const segment of args.segments) {
    if (segment.kind === "text") {
      text += segment.text;
      continue;
    }

    if (segment.mention.serializedText.length === 0) {
      throw new Error("Parent system mention text must not be empty");
    }
    const start = text.length;
    text += segment.mention.serializedText;
    mentions.push({
      start,
      end: text.length,
      resource: segment.mention.resource,
    });
  }

  return [{ type: "text", text, mentions }];
}

export function buildParentSystemInputFromTemplateSlot(
  args: BuildParentSystemInputFromTemplateSlotArgs,
): PromptInput[] {
  const parts = splitRenderedParentSystemSlot(args);
  return buildParentSystemInputFromSegments({
    segments: [
      { kind: "text", text: parts.prefix },
      ...args.segments,
      { kind: "text", text: parts.suffix },
    ],
  });
}

export function parentSystemThreadLabel(thread: {
  id: string;
  title: string | null;
}): string {
  return thread.title?.trim() || thread.id;
}

export function buildParentSystemThreadMention(
  args: BuildParentSystemThreadMentionArgs,
): ParentSystemRenderedMention {
  return {
    serializedText: `@thread:${args.thread.id}`,
    resource: {
      kind: "thread",
      label: parentSystemThreadLabel(args.thread),
      projectId: args.thread.projectId,
      threadId: args.thread.id,
    },
  };
}

export async function queueParentSystemMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueParentSystemMessageArgs,
): Promise<boolean> {
  const parentThread = getThread(deps.db, args.parentThreadId);
  if (
    !parentThread ||
    parentThread.archivedAt !== null ||
    parentThread.deletedAt !== null
  ) {
    return false;
  }
  const systemNotice: QueuedMessageSystemNotice = {
    kind: args.systemMessageKind,
    subject: args.systemMessageSubject,
  };
  try {
    await attemptDispatch(deps, {
      thread: parentThread,
      payload: { input: args.input, mode: "auto" },
      source: { kind: "inline" },
      queuePayload: { kind: "inline" },
      pluginSubmission: null,
      systemNotice,
      origin: null,
      originPluginId: null,
      startedOnBehalfOf: null,
      trigger: "auto-dispatch",
    });
    return true;
  } catch (error) {
    const currentThread = getThread(deps.db, parentThread.id);
    if (
      currentThread === null ||
      currentThread.archivedAt !== null ||
      currentThread.deletedAt !== null
    ) {
      return false;
    }
    const hostUnavailable = isHostUnavailableApiError(error);
    if (
      !(error instanceof ThreadContextClearInProgressError) &&
      !hostUnavailable
    ) {
      throw error;
    }
    const host = hostUnavailable
      ? getHost(
          deps.db,
          requireThreadEnvironment(deps.db, parentThread.id).environment.hostId,
        )
      : null;
    if (hostUnavailable && !host) {
      throw new Error(
        "Parent host disappeared while queueing a system message",
      );
    }
    recordQueuedMessageWait(deps, {
      thread: parentThread,
      message: {
        input: args.input,
        execution: await buildExecutionOptions(
          deps,
          {},
          { threadId: parentThread.id },
        ),
        senderThreadId: null,
        origin: null,
        originPluginId: null,
        requestedBy: null,
        payload: { kind: "inline" },
        systemNotice,
        deliveryMode: "steer",
        idempotencyKey: null,
      },
      waitingOn: host
        ? { kind: "host-offline", hostName: host.name }
        : { kind: "thread-busy" },
      sendAt: null,
      claimed: null,
    });
    if (!hostUnavailable) {
      requestQueuedMessageDispatch(deps, {
        kind: "thread-ready",
        threadId: parentThread.id,
      });
    }
    return true;
  }
}
