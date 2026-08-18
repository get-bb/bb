/**
 * Codex dialect parsing → narrow-grammar deltas.
 *
 * Codex's app-server natively emits turn/item/delta notifications with
 * provider ids, so this module is a near-1:1 mapping onto `thread/delta`
 * semantic deltas: every delta carries codex's own turn id as the vouched
 * `providerTurnId` join key and item ids as `key.providerItemId`; the runtime
 * delta assembler mints the bb ids and constructs the canonical events.
 *
 * The one dialect state here is the rate-limit snapshot merge (sparse rolling
 * updates inherit the previous snapshot's windows and keep the reached-reason
 * sticky while it is still provably active). It stays bridge-side because it
 * is seeded from a per-child `account/rateLimits/read` post-initialize call
 * the assembler never sees.
 */
import {
  type ProviderErrorCategory,
  type ProviderErrorInfo,
  type ProviderRateLimitState,
  type ProviderRateLimitStatus,
  type ProviderRateLimitWindow,
  providerRawEventSchema,
  type DeltaItemShape,
  type ProviderRawEvent,
  type ThreadDelta,
  type ThreadEventItemStatus,
  type ThreadEventTurnStatus,
  type ThreadEventUserContent,
  type JsonRpcMessage,
  type ProviderRuntimeEvent,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  codexBridgeEnvelopeSchema,
  codexHandledEventSchema,
  codexHandledThreadItemSchema,
  isHandledCodexMethod,
  type CodexDynamicToolCallContentItem,
  type CodexErrorInfo,
  type CodexHandledEvent,
  type CodexHandledThreadItem,
  type CodexItemStatus,
  type CodexParsedUserInput,
  type CodexRateLimitSnapshot,
  type CodexRateLimitSnapshotUpdate,
  type CodexTurnStatus,
} from "./schemas.js";
import { codexVisibilityMetadata } from "./visibility.js";

function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

interface CodexEventTranslationState {
  rateLimits: CodexRateLimitSnapshot | null;
}

export function createCodexEventTranslationState(): CodexEventTranslationState {
  return { rateLimits: null };
}

function clampRateLimitPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function codexWindowStatus(usedPercent: number): ProviderRateLimitStatus {
  if (usedPercent >= 100) return "blocked";
  if (usedPercent >= 90) return "warning";
  return "allowed";
}

function normalizeCodexRateLimitWindow(
  key: "primary" | "secondary",
  window: CodexRateLimitSnapshot["primary"],
): ProviderRateLimitWindow | null {
  if (!window) return null;
  const usedPercent = clampRateLimitPercent(window.usedPercent);
  return {
    providerKey: key,
    label: key === "primary" ? "Current session" : "Weekly limit",
    status: codexWindowStatus(usedPercent),
    resetsAtMs: window.resetsAt === null ? null : window.resetsAt * 1_000,
  };
}

function codexReachedReasonIsActive(
  snapshot: CodexRateLimitSnapshot,
  reachedReason: string,
): boolean {
  if (reachedReason === "rate_limit_reached") {
    return [snapshot.primary, snapshot.secondary].some(
      (window) => window !== null && window.usedPercent >= 100,
    );
  }
  if (reachedReason.includes("credits_depleted")) {
    return (
      snapshot.credits !== null &&
      !snapshot.credits.unlimited &&
      !snapshot.credits.hasCredits
    );
  }
  if (reachedReason.includes("usage_limit_reached")) {
    return (
      snapshot.individualLimit !== null &&
      snapshot.individualLimit.remainingPercent <= 0
    );
  }
  return false;
}

function mergeCodexRateLimitSnapshot(
  previous: CodexRateLimitSnapshot | null,
  update: CodexRateLimitSnapshotUpdate,
): CodexRateLimitSnapshot {
  const merged: CodexRateLimitSnapshot = {
    limitId: update.limitId ?? previous?.limitId ?? null,
    limitName: update.limitName ?? previous?.limitName ?? null,
    primary: update.primary ?? previous?.primary ?? null,
    secondary: update.secondary ?? previous?.secondary ?? null,
    credits: update.credits ?? previous?.credits ?? null,
    individualLimit:
      update.individualLimit ?? previous?.individualLimit ?? null,
    planType: update.planType ?? previous?.planType ?? null,
    rateLimitReachedType: update.rateLimitReachedType ?? null,
  };
  if (
    merged.rateLimitReachedType === null &&
    previous?.rateLimitReachedType !== null &&
    previous?.rateLimitReachedType !== undefined &&
    codexReachedReasonIsActive(merged, previous.rateLimitReachedType)
  ) {
    merged.rateLimitReachedType = previous.rateLimitReachedType;
  }
  return merged;
}

export function applyCodexRateLimitUpdate(
  state: CodexEventTranslationState,
  update: CodexRateLimitSnapshotUpdate,
): CodexRateLimitSnapshot {
  const rateLimits = mergeCodexRateLimitSnapshot(state.rateLimits, update);
  state.rateLimits = rateLimits;
  return rateLimits;
}

function normalizeCodexRateLimits(
  snapshot: CodexRateLimitSnapshot,
): ProviderRateLimitState {
  const windows = [
    normalizeCodexRateLimitWindow("primary", snapshot.primary),
    normalizeCodexRateLimitWindow("secondary", snapshot.secondary),
  ].filter((window): window is ProviderRateLimitWindow => window !== null);

  if (snapshot.individualLimit) {
    const usedPercent = clampRateLimitPercent(
      100 - snapshot.individualLimit.remainingPercent,
    );
    windows.push({
      providerKey: "individual-limit",
      label: "Spend control",
      status: codexWindowStatus(usedPercent),
      resetsAtMs: snapshot.individualLimit.resetsAt * 1_000,
    });
  }

  const reachedReason = snapshot.rateLimitReachedType;
  const kind =
    reachedReason === "rate_limit_reached"
      ? "subscription-window"
      : reachedReason?.includes("credits_depleted")
        ? "credits"
        : reachedReason?.includes("usage_limit_reached")
          ? "spend-control"
          : reachedReason !== null
            ? "unknown"
            : snapshot.credits !== null &&
                !snapshot.credits.unlimited &&
                !snapshot.credits.hasCredits
              ? "credits"
              : snapshot.individualLimit !== null
                ? "spend-control"
                : snapshot.primary !== null || snapshot.secondary !== null
                  ? "subscription-window"
                  : "unknown";
  const status =
    reachedReason !== null
      ? "blocked"
      : windows.some((window) => window.status === "blocked")
        ? "blocked"
        : windows.some((window) => window.status === "warning")
          ? "warning"
          : windows.length > 0 || snapshot.credits?.hasCredits === true
            ? "allowed"
            : "unknown";

  return {
    providerId: "codex",
    status,
    kind,
    windows,
    reachedReason,
    overageStatus: null,
    overageReason: null,
  };
}

type CodexErrorEvent = Extract<CodexHandledEvent, { method: "error" }>;
type CodexErrorPayload = CodexErrorEvent["params"]["error"];

type CodexItemTranslationResult =
  | {
      kind: "translated";
      shape: DeltaItemShape;
      status: ThreadEventItemStatus;
      approvalDenied: boolean;
    }
  | { kind: "ignored" }
  | { kind: "unhandled" };

function getCodexErrorProviderCode(errorInfo: CodexErrorInfo): string {
  if (typeof errorInfo === "string") {
    return errorInfo;
  }
  if ("httpConnectionFailed" in errorInfo) {
    return "httpConnectionFailed";
  }
  if ("responseStreamConnectionFailed" in errorInfo) {
    return "responseStreamConnectionFailed";
  }
  if ("responseStreamDisconnected" in errorInfo) {
    return "responseStreamDisconnected";
  }
  if ("responseTooManyFailedAttempts" in errorInfo) {
    return "responseTooManyFailedAttempts";
  }
  if ("activeTurnNotSteerable" in errorInfo) {
    return "activeTurnNotSteerable";
  }
  return assertNever(errorInfo);
}

function getCodexErrorHttpStatusCode(errorInfo: CodexErrorInfo): number | null {
  if (typeof errorInfo === "string") {
    return null;
  }
  if ("httpConnectionFailed" in errorInfo) {
    return errorInfo.httpConnectionFailed.httpStatusCode;
  }
  if ("responseStreamConnectionFailed" in errorInfo) {
    return errorInfo.responseStreamConnectionFailed.httpStatusCode;
  }
  if ("responseStreamDisconnected" in errorInfo) {
    return errorInfo.responseStreamDisconnected.httpStatusCode;
  }
  if ("responseTooManyFailedAttempts" in errorInfo) {
    return errorInfo.responseTooManyFailedAttempts.httpStatusCode;
  }
  if ("activeTurnNotSteerable" in errorInfo) {
    return null;
  }
  return assertNever(errorInfo);
}

function getProviderErrorCategory(
  errorInfo: CodexErrorInfo,
): ProviderErrorCategory {
  if (typeof errorInfo === "string") {
    switch (errorInfo) {
      case "contextWindowExceeded":
        return "context-window-exceeded";
      case "usageLimitExceeded":
        return "rate-limit";
      case "serverOverloaded":
        return "overloaded";
      case "cyberPolicy":
        return "policy";
      case "internalServerError":
        return "internal";
      case "unauthorized":
        return "unauthorized";
      case "badRequest":
        return "bad-request";
      case "threadRollbackFailed":
        return "thread-rollback-failed";
      case "sandboxError":
        return "sandbox";
      case "other":
        return "unknown";
    }
  }
  if ("httpConnectionFailed" in errorInfo) {
    return "connection-failed";
  }
  if ("responseStreamConnectionFailed" in errorInfo) {
    return "connection-failed";
  }
  if ("responseStreamDisconnected" in errorInfo) {
    return "stream-disconnected";
  }
  if ("responseTooManyFailedAttempts" in errorInfo) {
    return "too-many-failed-attempts";
  }
  if ("activeTurnNotSteerable" in errorInfo) {
    return "active-turn-not-steerable";
  }
  return assertNever(errorInfo);
}

function toProviderErrorInfo(
  error: CodexErrorPayload,
): ProviderErrorInfo | null {
  const errorInfo = error.codexErrorInfo;
  if (!errorInfo) {
    return null;
  }
  return {
    category: getProviderErrorCategory(errorInfo),
    providerCode: getCodexErrorProviderCode(errorInfo),
    httpStatusCode: getCodexErrorHttpStatusCode(errorInfo),
  };
}

function toRawEvent(rawEvent: JsonRpcMessage): ProviderRawEvent {
  const parsed = providerRawEventSchema.safeParse(rawEvent);
  if (parsed.success) {
    return parsed.data;
  }
  return {
    jsonrpc: "2.0",
    ...(rawEvent.id !== undefined ? { id: rawEvent.id } : {}),
    method: rawEvent.method,
    params: {
      serializationError:
        "Provider raw event params were not JSON-serializable.",
    },
  };
}

interface CodexUnhandledDeltaArgs {
  rawEvent: JsonRpcMessage;
  rawType?: string;
  providerTurnId?: string;
  parentRef?: string;
}

function buildUnhandledCodexDeltas(
  args: CodexUnhandledDeltaArgs,
): ThreadDelta[] {
  const description = codexVisibilityMetadata.describeRawEvent(args.rawEvent);
  if (description.coverage !== "unknown" && args.rawType === undefined) {
    return [];
  }

  return [
    {
      kind: "unhandled",
      raw: toRawEvent(args.rawEvent),
      rawType: args.rawType ?? description.kind,
      // Codex's own notifications name their turn; only a vouched turn id
      // may turn-scope the event (the only-caller-vouched-turn-ids rule).
      vouchedTurn: args.providerTurnId !== undefined,
      ...(args.providerTurnId !== undefined
        ? { providerTurnId: args.providerTurnId }
        : {}),
      ...(args.parentRef !== undefined ? { parentRef: args.parentRef } : {}),
    },
  ];
}

function toTurnStatus(status: CodexTurnStatus): ThreadEventTurnStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "inProgress":
      return "completed";
    default:
      return assertNever(status);
  }
}

function toItemStatus(status: CodexItemStatus): ThreadEventItemStatus {
  switch (status) {
    case "inProgress":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "declined":
      return "interrupted";
    default:
      return assertNever(status);
  }
}

function translateCodexUserContent(
  content: CodexParsedUserInput,
): ThreadEventUserContent {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text };
    case "image":
      return { type: "image", url: content.url };
    case "localImage":
      return { type: "localImage", path: content.path };
    case "skill":
    case "mention":
      return { type: "text", text: `[${content.type}: ${content.name}]` };
    default:
      return assertNever(content);
  }
}

function extractDynamicToolCallResult(
  contentItems: CodexDynamicToolCallContentItem[] | null,
): unknown {
  if (!contentItems || contentItems.length === 0) {
    return undefined;
  }

  const parts = contentItems
    .map((contentItem) => {
      switch (contentItem.type) {
        case "inputText":
          return contentItem.text;
        case "inputImage":
          return `[image: ${contentItem.imageUrl}]`;
      }
    })
    .filter((part) => part.trim().length > 0);

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n");
}

function buildDynamicToolCallError(
  success: boolean | null,
  result: unknown,
): string | undefined {
  if (success !== false) {
    return undefined;
  }
  if (typeof result === "string" && result.trim().length > 0) {
    return result;
  }
  return "Dynamic tool call failed";
}

function collectNonEmptyStrings(
  values: Array<string | null | undefined>,
): string[] {
  return values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

interface CodexSearchQueriesArgs {
  itemQuery: string;
  actionQuery: string | null | undefined;
  actionQueries: string[] | null | undefined;
}

function normalizeCodexSearchQueries(
  args: CodexSearchQueriesArgs,
): string[] | null {
  const queries = dedupeStrings(
    collectNonEmptyStrings([
      ...(args.actionQueries ?? []),
      args.actionQuery,
      args.itemQuery,
    ]),
  );
  return queries.length > 0 ? queries : null;
}

interface CodexUrlArgs {
  actionUrl: string | null | undefined;
}

function normalizeCodexUrl(args: CodexUrlArgs): string | null {
  const url = collectNonEmptyStrings([args.actionUrl])[0];
  return url ?? null;
}

function normalizeCodexWebItemShape(
  item: Extract<CodexHandledThreadItem, { type: "webSearch" }>,
): DeltaItemShape | null {
  if (!item.action) {
    return null;
  }

  switch (item.action.type) {
    case "search": {
      const queries = normalizeCodexSearchQueries({
        itemQuery: item.query,
        actionQuery: item.action.query,
        actionQueries: item.action.queries,
      });
      if (!queries) {
        return null;
      }
      return { type: "webSearch", queries };
    }
    case "openPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return { type: "webFetch", url, pattern: null };
    }
    case "findInPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return { type: "webFetch", url, pattern: item.action.pattern ?? null };
    }
    case "other":
      return null;
    default:
      return assertNever(item.action);
  }
}

function shouldIgnoreCodexWebItem(
  item: Extract<CodexHandledThreadItem, { type: "webSearch" }>,
): boolean {
  return item.action === null || item.action.type === "other";
}

function toolStatusFields(status: CodexItemStatus): {
  status: ThreadEventItemStatus;
  approvalDenied: boolean;
} {
  return {
    status: toItemStatus(status),
    // Only completed declined items represent a denied approval/policy; the
    // caller applies this on item.close only (a started event is not
    // terminal even if Codex includes a terminal-looking status).
    approvalDenied: status === "declined",
  };
}

function translateCodexItemShape(item: unknown): CodexItemTranslationResult {
  const parsed = codexHandledThreadItemSchema.safeParse(item);
  if (!parsed.success) {
    return { kind: "unhandled" };
  }

  const parsedItem: CodexHandledThreadItem = parsed.data;
  switch (parsedItem.type) {
    case "agentMessage":
      return {
        kind: "translated",
        shape: { type: "agentMessage", text: parsedItem.text },
        status: "completed",
        approvalDenied: false,
      };
    case "userMessage":
      // bb already owns the user message it sent; the provider's echo of it
      // would render a duplicate.
      return { kind: "ignored" };
    case "commandExecution":
      return {
        kind: "translated",
        shape: {
          type: "command",
          command: parsedItem.command,
          cwd: parsedItem.cwd,
          ...(parsedItem.aggregatedOutput === null
            ? {}
            : { aggregatedOutput: parsedItem.aggregatedOutput }),
          ...(parsedItem.exitCode === null
            ? {}
            : { exitCode: parsedItem.exitCode }),
          ...(parsedItem.durationMs === null
            ? {}
            : { durationMs: parsedItem.durationMs }),
        },
        ...toolStatusFields(parsedItem.status),
      };
    case "fileChange":
      return {
        kind: "translated",
        shape: {
          type: "fileChange",
          changes: parsedItem.changes.map((change) => ({
            path: change.path,
            kind: change.kind.type,
            ...(change.kind.type === "update" && change.kind.move_path
              ? { movePath: change.kind.move_path }
              : {}),
            ...(change.diff ? { diff: change.diff } : {}),
          })),
        },
        ...toolStatusFields(parsedItem.status),
      };
    case "mcpToolCall":
      return {
        kind: "translated",
        shape: {
          type: "tool",
          server: parsedItem.server,
          tool: parsedItem.tool,
          ...(parsedItem.arguments === undefined
            ? {}
            : { args: parsedItem.arguments }),
          ...(parsedItem.error?.message === undefined
            ? {}
            : { error: parsedItem.error.message }),
          ...(parsedItem.durationMs === null || parsedItem.durationMs === undefined
            ? {}
            : { durationMs: parsedItem.durationMs }),
        },
        ...toolStatusFields(parsedItem.status),
      };
    case "dynamicToolCall": {
      const result = extractDynamicToolCallResult(parsedItem.contentItems);
      const error = buildDynamicToolCallError(parsedItem.success, result);
      return {
        kind: "translated",
        shape: {
          type: "tool",
          tool: parsedItem.tool,
          ...(parsedItem.arguments === undefined
            ? {}
            : { args: parsedItem.arguments }),
          ...(result === undefined ? {} : { result }),
          ...(error === undefined ? {} : { error }),
          ...(parsedItem.durationMs === null || parsedItem.durationMs === undefined
            ? {}
            : { durationMs: parsedItem.durationMs }),
        },
        ...toolStatusFields(parsedItem.status),
      };
    }
    case "collabAgentToolCall":
      return {
        kind: "translated",
        shape: {
          type: "tool",
          tool: parsedItem.tool,
          args: {
            senderThreadId: parsedItem.senderThreadId,
            receiverThreadIds: parsedItem.receiverThreadIds,
            ...(parsedItem.prompt ? { prompt: parsedItem.prompt } : {}),
            ...(parsedItem.model ? { model: parsedItem.model } : {}),
            ...(parsedItem.reasoningEffort
              ? { reasoningEffort: parsedItem.reasoningEffort }
              : {}),
          },
          result: parsedItem.agentsStates,
        },
        ...toolStatusFields(parsedItem.status),
      };
    case "subAgentActivity":
      // The translator handles this statefully so it can correlate the
      // activity with the child turn and close the synthetic delegation row.
      return { kind: "ignored" };
    case "webSearch": {
      if (shouldIgnoreCodexWebItem(parsedItem)) {
        return { kind: "ignored" };
      }
      const shape = normalizeCodexWebItemShape(parsedItem);
      return shape
        ? { kind: "translated", shape, status: "completed", approvalDenied: false }
        : { kind: "unhandled" };
    }
    case "imageView":
      return {
        kind: "translated",
        shape: { type: "imageView", path: parsedItem.path },
        status: "completed",
        approvalDenied: false,
      };
    case "reasoning":
      return {
        kind: "translated",
        shape: {
          type: "reasoning",
          summary: parsedItem.summary,
          content: parsedItem.content,
        },
        status: "completed",
        approvalDenied: false,
      };
    case "plan":
      return {
        kind: "translated",
        shape: { type: "plan", text: parsedItem.text },
        status: "completed",
        approvalDenied: false,
      };
    case "contextCompaction":
      return {
        kind: "translated",
        shape: { type: "compaction" },
        status: "completed",
        approvalDenied: false,
      };
    default:
      return assertNever(parsedItem);
  }
}

export function translateCodexEventToDeltas(
  event: ProviderRuntimeEvent,
  state: CodexEventTranslationState,
): ThreadDelta[] {
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    return [];
  }

  const rawEvent: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: envelope.data.method,
    ...(envelope.data.params ? { params: envelope.data.params } : {}),
  };

  const parsed = codexHandledEventSchema.safeParse(rawEvent);
  if (!parsed.success) {
    return isHandledCodexMethod(rawEvent.method)
      ? buildUnhandledCodexDeltas({ rawEvent, rawType: rawEvent.method })
      : buildUnhandledCodexDeltas({ rawEvent });
  }

  const handledEvent: CodexHandledEvent = parsed.data;
  switch (handledEvent.method) {
    case "account/rateLimits/updated": {
      const rateLimits = applyCodexRateLimitUpdate(
        state,
        handledEvent.params.rateLimits,
      );
      return [
        {
          kind: "provider.rateLimits",
          rateLimits: normalizeCodexRateLimits(rateLimits),
        },
      ];
    }
    case "turn/started":
      return [
        { kind: "turn.open", providerTurnId: handledEvent.params.turn.id },
      ];
    case "turn/completed": {
      const status = toTurnStatus(handledEvent.params.turn.status);
      return [
        {
          kind: "turn.boundary",
          providerTurnId: handledEvent.params.turn.id,
          status,
          ...(handledEvent.params.turn.error?.message
            ? { error: { message: handledEvent.params.turn.error.message } }
            : {}),
          // The Codex turn id is the value codex thread/fork accepts as
          // lastTurnId, and unlike any in-memory map it survives bridge and
          // runtime restarts. Only completed turns are fork points — a failed
          // or interrupted turn may be absent from the rollout.
          ...(status === "completed"
            ? { providerCheckpointId: handledEvent.params.turn.id }
            : {}),
        },
      ];
    }
    case "thread/started": {
      const deltas: ThreadDelta[] = [
        { kind: "thread.started" },
        {
          kind: "thread.identity",
          providerThreadId: handledEvent.params.thread.id,
        },
      ];
      if (handledEvent.params.thread.preview) {
        deltas.push({
          kind: "thread.name",
          name: handledEvent.params.thread.preview,
        });
      }
      return deltas;
    }
    case "thread/archived":
    case "thread/unarchived":
      return [];
    case "thread/name/updated":
      return handledEvent.params.threadName
        ? [{ kind: "thread.name", name: handledEvent.params.threadName }]
        : [];
    case "thread/compacted":
      return [
        {
          kind: "context.compacted",
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "thread/goal/updated":
      return [
        {
          kind: "thread.goal",
          objective: handledEvent.params.goal.objective,
          status: handledEvent.params.goal.status,
          tokenBudget: handledEvent.params.goal.tokenBudget,
          tokensUsed: handledEvent.params.goal.tokensUsed,
          timeUsedSeconds: handledEvent.params.goal.timeUsedSeconds,
        },
      ];
    case "thread/goal/cleared":
      return [{ kind: "thread.goalCleared" }];
    case "item/started":
    case "item/completed": {
      const translation = translateCodexItemShape(handledEvent.params.item);
      if (translation.kind === "ignored") {
        return [];
      }
      if (translation.kind === "unhandled") {
        return buildUnhandledCodexDeltas({
          rawEvent,
          rawType: handledEvent.method,
          providerTurnId: handledEvent.params.turnId,
        });
      }
      const key = { providerItemId: handledEvent.params.item.id };
      if (handledEvent.method === "item/started") {
        return [
          {
            kind: "item.open",
            key,
            item: translation.shape,
            providerTurnId: handledEvent.params.turnId,
          },
        ];
      }
      return [
        {
          kind: "item.close",
          key,
          status: translation.status,
          ...(translation.approvalDenied ? { approvalStatus: "denied" } : {}),
          item: translation.shape,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    }
    case "item/agentMessage/delta":
      return [
        {
          kind: "item.textDelta",
          key: { providerItemId: handledEvent.params.itemId },
          channel: "agentMessage",
          text: handledEvent.params.delta,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "item/commandExecution/outputDelta":
      return [
        {
          kind: "item.outputDelta",
          key: { providerItemId: handledEvent.params.itemId },
          channel: "command",
          text: handledEvent.params.delta,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "item/fileChange/outputDelta":
      return [
        {
          kind: "item.outputDelta",
          key: { providerItemId: handledEvent.params.itemId },
          channel: "fileChange",
          text: handledEvent.params.delta,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "item/reasoning/summaryTextDelta":
      return [
        {
          kind: "item.textDelta",
          key: { providerItemId: handledEvent.params.itemId },
          channel: "reasoningSummary",
          text: handledEvent.params.delta,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "item/reasoning/textDelta":
      return [
        {
          kind: "item.textDelta",
          key: { providerItemId: handledEvent.params.itemId },
          channel: "reasoningText",
          text: handledEvent.params.delta,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "item/plan/delta":
      return [
        {
          kind: "item.textDelta",
          key: { providerItemId: handledEvent.params.itemId },
          channel: "plan",
          text: handledEvent.params.delta,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "item/mcpToolCall/progress":
      return [
        {
          kind: "item.progress",
          key: { providerItemId: handledEvent.params.itemId },
          ...(handledEvent.params.message
            ? { message: handledEvent.params.message }
            : {}),
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "thread/tokenUsage/updated":
      return [
        {
          kind: "usage.exact",
          total: {
            totalTokens: handledEvent.params.tokenUsage.total.totalTokens,
            inputTokens: handledEvent.params.tokenUsage.total.inputTokens,
            cachedInputTokens:
              handledEvent.params.tokenUsage.total.cachedInputTokens,
            outputTokens: handledEvent.params.tokenUsage.total.outputTokens,
            reasoningOutputTokens:
              handledEvent.params.tokenUsage.total.reasoningOutputTokens,
          },
          last: {
            totalTokens: handledEvent.params.tokenUsage.last.totalTokens,
            inputTokens: handledEvent.params.tokenUsage.last.inputTokens,
            cachedInputTokens:
              handledEvent.params.tokenUsage.last.cachedInputTokens,
            outputTokens: handledEvent.params.tokenUsage.last.outputTokens,
            reasoningOutputTokens:
              handledEvent.params.tokenUsage.last.reasoningOutputTokens,
          },
          modelContextWindow: handledEvent.params.tokenUsage.modelContextWindow,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "turn/plan/updated":
      return [
        {
          kind: "turn.plan",
          steps: handledEvent.params.plan.map((step) => ({
            step: step.step,
            status: step.status === "inProgress" ? "active" : step.status,
          })),
          ...(handledEvent.params.explanation
            ? { explanation: handledEvent.params.explanation }
            : {}),
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "turn/diff/updated":
      return [
        {
          kind: "turn.diff",
          diff: handledEvent.params.diff,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "error": {
      const errorInfo = toProviderErrorInfo(handledEvent.params.error);
      return [
        {
          kind: "provider.error",
          message: "Provider error",
          detail: handledEvent.params.error.additionalDetails
            ? `${handledEvent.params.error.message}\n${handledEvent.params.error.additionalDetails}`
            : handledEvent.params.error.message,
          ...(handledEvent.params.willRetry !== undefined
            ? { willRetry: handledEvent.params.willRetry }
            : {}),
          ...(errorInfo ? { errorInfo } : {}),
          // Codex names its turn when the error belongs to one; an error
          // without a native turn id must stay thread-scoped even mid-turn.
          ...(handledEvent.params.turnId !== undefined
            ? { providerTurnId: handledEvent.params.turnId }
            : { threadScoped: true }),
        },
      ];
    }
    case "deprecationNotice":
      return [
        {
          kind: "provider.warning",
          category: "deprecation",
          summary: handledEvent.params.summary,
          ...(handledEvent.params.details
            ? { details: handledEvent.params.details }
            : {}),
        },
      ];
    case "configWarning":
      return [
        {
          kind: "provider.warning",
          category: "config",
          summary: handledEvent.params.summary,
          ...(handledEvent.params.details
            ? { details: handledEvent.params.details }
            : {}),
        },
      ];
    default:
      return assertNever(handledEvent);
  }
}
