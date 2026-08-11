import {
  type PromptInput,
  type PromptTextMention,
  type ThreadEvent,
} from "@bb/domain";
import type { EventMeta } from "./event-decode.js";
import type { AcceptedClientRequest } from "./accepted-client-request-context.js";
import type {
  BuildEventProjectionMessagesOptions,
  EventProjectionAssistantTextMessage,
  EventProjectionTurnRequestKind,
  EventProjectionTurnRequest,
  EventProjectionUserMessage,
} from "./event-projection-types.js";
import { messageId } from "./format-helpers.js";
import { assertNever } from "./assert-never.js";
import { eventProjectionMessageTurnScopeFields } from "./message-scope.js";
import { parseAgentMessageEnvelope } from "./agent-message-envelope.js";

export function parsePromptInput(
  input: ReadonlyArray<PromptInput> | undefined,
): {
  text: string;
  webImages: number;
  localImages: number;
  localFiles: number;
  imageUrls: string[];
  localImagePaths: string[];
  localFilePaths: string[];
  mentions: PromptTextMention[];
} | null {
  if (!Array.isArray(input) || input.length === 0) return null;

  const textParts: string[] = [];
  let webImages = 0;
  let localImages = 0;
  let localFiles = 0;
  const imageUrls: string[] = [];
  const localImagePaths: string[] = [];
  const localFilePaths: string[] = [];
  const mentions: PromptTextMention[] = [];
  let textOffset = 0;

  for (const part of input) {
    if (part.visibility === "agent-only") {
      continue;
    }

    switch (part.type) {
      case "text":
        if (part.text.length > 0) {
          for (const mention of part.mentions) {
            if (
              mention.start >= 0 &&
              mention.end > mention.start &&
              mention.end <= part.text.length
            ) {
              mentions.push({
                ...mention,
                start: textOffset + mention.start,
                end: textOffset + mention.end,
              });
            }
          }
          textParts.push(part.text);
          textOffset += part.text.length;
        }
        break;
      case "image":
        webImages += 1;
        if (part.url.length > 0) {
          imageUrls.push(part.url);
        }
        break;
      case "localImage":
        localImages += 1;
        if (part.path.length > 0) {
          localImagePaths.push(part.path);
        }
        break;
      case "localFile":
        localFiles += 1;
        if (part.path.length > 0) {
          localFilePaths.push(part.path);
        }
        break;
    }
  }

  const text = textParts.join("");
  if (!text && webImages === 0 && localImages === 0 && localFiles === 0) {
    return null;
  }

  return {
    text,
    webImages,
    localImages,
    localFiles,
    imageUrls,
    localImagePaths,
    localFilePaths,
    mentions,
  };
}

export function shouldRenderClientRequestedInput(
  threadStatus: BuildEventProjectionMessagesOptions["threadStatus"] | undefined,
): boolean {
  if (!threadStatus) return false;
  switch (threadStatus) {
    case "starting":
    case "error":
    case "idle":
    case "active":
    case "stopping":
      return true;
    default:
      return assertNever(threadStatus);
  }
}

export function shouldPreservePendingMessages(
  threadStatus: BuildEventProjectionMessagesOptions["threadStatus"] | undefined,
): boolean {
  if (!threadStatus) return false;
  switch (threadStatus) {
    case "starting":
    case "active":
      return true;
    case "error":
    case "idle":
    case "stopping":
      return false;
    default:
      return assertNever(threadStatus);
  }
}

function buildAttachments(
  parsed: NonNullable<ReturnType<typeof parsePromptInput>>,
): EventProjectionUserMessage["attachments"] {
  return {
    webImages: parsed.webImages,
    localImages: parsed.localImages,
    localFiles: parsed.localFiles,
    ...(parsed.imageUrls.length > 0 ? { imageUrls: parsed.imageUrls } : {}),
    ...(parsed.localImagePaths.length > 0
      ? { localImagePaths: parsed.localImagePaths }
      : {}),
    ...(parsed.localFilePaths.length > 0
      ? { localFilePaths: parsed.localFilePaths }
      : {}),
  };
}

export interface ParseUserFromClientRequestArgs {
  acceptedClientRequest?: AcceptedClientRequest;
  decoded: ThreadEvent;
  meta: EventMeta;
  options?: BuildEventProjectionMessagesOptions;
}

export interface ParseAcceptedSteerFromClientRequestArgs extends ParseUserFromClientRequestArgs {
  acceptedClientRequest: AcceptedClientRequest;
}

export interface ParsePendingSteerFromClientRequestArgs extends ParseUserFromClientRequestArgs {
  acceptedClientRequest: AcceptedClientRequest | undefined;
}

type ClientTurnRequestedEvent = Extract<
  ThreadEvent,
  { type: "client/turn/requested" }
>;

interface ResolveTurnRequestKindArgs {
  acceptedClientRequest: AcceptedClientRequest | undefined;
  decoded: ClientTurnRequestedEvent;
}

function expectedSteerTurnId(decoded: ClientTurnRequestedEvent): string | null {
  switch (decoded.target.kind) {
    case "auto":
    case "steer":
      return decoded.target.expectedTurnId;
    case "thread-start":
    case "new-turn":
      return null;
    default:
      return assertNever(decoded.target);
  }
}

function resolveTurnRequestKind({
  acceptedClientRequest,
  decoded,
}: ResolveTurnRequestKindArgs): EventProjectionTurnRequestKind {
  const expectedTurnId = expectedSteerTurnId(decoded);
  if (expectedTurnId === null) {
    return "message";
  }
  if (
    acceptedClientRequest !== undefined &&
    acceptedClientRequest.turnId !== expectedTurnId
  ) {
    return "message";
  }
  return "steer";
}

export function isSteerRequest(decoded: ClientTurnRequestedEvent): boolean {
  return (
    resolveTurnRequestKind({
      acceptedClientRequest: undefined,
      decoded,
    }) === "steer"
  );
}

function buildTurnRequest(
  decoded: ClientTurnRequestedEvent,
  status: EventProjectionTurnRequest["status"],
  acceptedClientRequest: AcceptedClientRequest | undefined,
): EventProjectionTurnRequest {
  return {
    isGrouped: decoded.inputGroups !== undefined,
    kind: resolveTurnRequestKind({
      acceptedClientRequest,
      decoded,
    }),
    status,
  };
}

function resolveClientUserMessageTurnId(
  decoded: ClientTurnRequestedEvent,
  acceptedClientRequest: AcceptedClientRequest | undefined,
): string | null {
  if (decoded.target.kind === "thread-start") {
    return null;
  }
  return (
    acceptedClientRequest?.turnId ??
    ("expectedTurnId" in decoded.target ? decoded.target.expectedTurnId : null)
  );
}

interface BuildClientUserMessageArgs {
  acceptedClientRequest?: AcceptedClientRequest;
  decoded: ClientTurnRequestedEvent;
  idSuffix?: string;
  input: ReadonlyArray<PromptInput>;
  meta: EventMeta;
  requestStatus: EventProjectionTurnRequest["status"];
}

function buildClientUserMessage({
  acceptedClientRequest,
  decoded,
  idSuffix,
  input,
  meta,
  requestStatus,
}: BuildClientUserMessageArgs): EventProjectionUserMessage {
  const parsedInput = parsePromptInput(input);
  if (!parsedInput) {
    throw new Error("Expected parsed prompt input");
  }
  const targetTurnId = resolveClientUserMessageTurnId(
    decoded,
    acceptedClientRequest,
  );
  const turnRequest = buildTurnRequest(
    decoded,
    requestStatus,
    acceptedClientRequest,
  );
  const rowMeta =
    acceptedClientRequest && turnRequest.kind === "steer"
      ? acceptedClientRequest.meta
      : meta;
  // Recover the structured source for legacy cross-thread requests that were
  // persisted as ordinary user turns. The reserved envelope is written by BB,
  // so an exact match is authoritative even when old event metadata is absent.
  const agentEnvelope = parseAgentMessageEnvelope(parsedInput.text);
  const initiator =
    decoded.initiator === "user" && agentEnvelope !== null
      ? "agent"
      : decoded.initiator;
  const senderThreadId =
    decoded.senderThreadId ??
    (initiator === "agent" ? (agentEnvelope?.senderThreadId ?? null) : null);

  return {
    kind: "user",
    id: messageId(
      decoded.threadId,
      "user-seed",
      idSuffix ? `${meta.seq}-${idSuffix}` : `${meta.seq}`,
    ),
    threadId: decoded.threadId,
    sourceSeqStart: rowMeta.seq,
    sourceSeqEnd: rowMeta.seq,
    createdAt: rowMeta.createdAt,
    ...(targetTurnId
      ? eventProjectionMessageTurnScopeFields(targetTurnId)
      : { scope: decoded.scope }),
    initiator,
    senderThreadId,
    // Legacy defaulting lives in `storedTurnRequestEventDataSchema`, so decoded
    // rows always carry concrete values at runtime. These `??` fallbacks only
    // satisfy the base in-flight schema's `.optional()` static type; they never
    // fire for a decoded stored event.
    systemMessageKind: decoded.systemMessageKind ?? "unlabeled",
    systemMessageSubject: decoded.systemMessageSubject ?? null,
    turnRequest,
    text: parsedInput.text,
    mentions: parsedInput.mentions,
    attachments: buildAttachments(parsedInput),
  };
}

function clientUserMessageIdSuffix(messageIndex: number): string | undefined {
  return messageIndex > 0 ? String(messageIndex) : undefined;
}

export function parseUserFromClientRequest(
  args: ParseUserFromClientRequestArgs,
): EventProjectionUserMessage | null {
  const { acceptedClientRequest, decoded, meta, options } = args;
  if (decoded.type !== "client/turn/requested") {
    return null;
  }

  const parsedInput = parsePromptInput(decoded.input);
  if (!parsedInput) return null;
  if (!shouldRenderClientRequestedInput(options?.threadStatus)) {
    return null;
  }

  // Steers flow through parsePendingSteer / parseAcceptedSteer regardless of
  // initiator — the steer-vs-message distinction is about turn shape, not who
  // initiated it.
  if (
    resolveTurnRequestKind({
      acceptedClientRequest,
      decoded,
    }) !== "message"
  ) {
    return null;
  }

  return buildClientUserMessage({
    acceptedClientRequest,
    decoded,
    input: decoded.input,
    meta,
    requestStatus: acceptedClientRequest ? "accepted" : "pending",
  });
}

export function parseUsersFromClientRequest(
  args: ParseUserFromClientRequestArgs,
): EventProjectionUserMessage[] {
  const { acceptedClientRequest, decoded, meta, options } = args;
  if (decoded.type !== "client/turn/requested") {
    return [];
  }
  if (!shouldRenderClientRequestedInput(options?.threadStatus)) {
    return [];
  }
  if (
    resolveTurnRequestKind({
      acceptedClientRequest,
      decoded,
    }) !== "message"
  ) {
    return [];
  }

  const groups = decoded.inputGroups ?? [decoded.input];
  const messages: EventProjectionUserMessage[] = [];
  for (const input of groups) {
    const parsedInput = parsePromptInput(input);
    if (!parsedInput) continue;
    const visibleMessageIndex = messages.length;
    messages.push(
      buildClientUserMessage({
        acceptedClientRequest,
        decoded,
        idSuffix: clientUserMessageIdSuffix(visibleMessageIndex),
        input,
        meta,
        requestStatus: acceptedClientRequest ? "accepted" : "pending",
      }),
    );
  }
  return messages;
}

export function parsePendingSteerFromClientRequest(
  args: ParsePendingSteerFromClientRequestArgs,
): EventProjectionUserMessage | null {
  return parsePendingSteersFromClientRequest(args)[0] ?? null;
}

export function parsePendingSteersFromClientRequest(
  args: ParsePendingSteerFromClientRequestArgs,
): EventProjectionUserMessage[] {
  const { acceptedClientRequest, decoded, meta, options } = args;
  if (acceptedClientRequest || decoded.type !== "client/turn/requested") {
    return [];
  }
  if (!isSteerRequest(decoded)) {
    return [];
  }
  if (!shouldPreservePendingMessages(options?.threadStatus)) {
    return [];
  }

  const groups = decoded.inputGroups ?? [decoded.input];
  const messages: EventProjectionUserMessage[] = [];
  for (const input of groups) {
    if (!parsePromptInput(input)) continue;
    const visibleMessageIndex = messages.length;
    messages.push(
      buildClientUserMessage({
        decoded,
        idSuffix: clientUserMessageIdSuffix(visibleMessageIndex),
        input,
        meta,
        requestStatus: "pending",
      }),
    );
  }
  return messages;
}

export function parseAcceptedSteerFromClientRequest(
  args: ParseAcceptedSteerFromClientRequestArgs,
): EventProjectionUserMessage | null {
  return parseAcceptedSteersFromClientRequest(args)[0] ?? null;
}

export function parseAcceptedSteersFromClientRequest(
  args: ParseAcceptedSteerFromClientRequestArgs,
): EventProjectionUserMessage[] {
  const { acceptedClientRequest, decoded, meta, options } = args;
  if (decoded.type !== "client/turn/requested") {
    return [];
  }
  if (
    resolveTurnRequestKind({
      acceptedClientRequest,
      decoded,
    }) !== "steer"
  ) {
    return [];
  }
  if (!shouldRenderClientRequestedInput(options?.threadStatus)) {
    return [];
  }

  const groups = decoded.inputGroups ?? [decoded.input];
  const messages: EventProjectionUserMessage[] = [];
  for (const input of groups) {
    if (!parsePromptInput(input)) continue;
    const visibleMessageIndex = messages.length;
    messages.push(
      buildClientUserMessage({
        acceptedClientRequest,
        decoded,
        idSuffix: clientUserMessageIdSuffix(visibleMessageIndex),
        input,
        meta,
        requestStatus: "accepted",
      }),
    );
  }
  return messages;
}

export function parseLegacyUserMessage(
  decoded: ThreadEvent,
  meta: EventMeta,
): EventProjectionAssistantTextMessage | null {
  if (decoded.type !== "system/manager/user_message") {
    return null;
  }

  const { text } = decoded;
  if (!text) {
    return null;
  }

  return {
    kind: "assistant-text",
    id: messageId(decoded.threadId, "assistant", `legacy:${meta.seq}`),
    threadId: decoded.threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    scope: decoded.scope,
    text,
    status: "completed",
    isLegacyUserMessage: true,
  };
}
