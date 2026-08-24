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
  type DeltaPresentation,
  type ProviderRawEvent,
  type ThreadDelta,
  type ThreadEventItemStatus,
  type ThreadEventTurnStatus,
  type JsonRpcMessage,
  type ProviderRuntimeEvent,
  experimental_COMPACTION_PRESENTATION as COMPACTION_PRESENTATION,
  experimental_REASONING_PRESENTATION as REASONING_PRESENTATION,
  experimental_toolPresentation as toolPresentation,
  experimental_webFetchPresentation as webFetchPresentation,
  experimental_webSearchPresentation as webSearchPresentation,
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
  type CodexRateLimitSnapshot,
  type CodexRateLimitSnapshotUpdate,
  type CodexTurnStatus,
} from "./schemas.js";
import {
  AGENT_MESSAGE_PRESENTATION,
  PLAN_PRESENTATION,
  collabAgentPresentation,
  commandPresentation,
  fileChangePresentation,
  imageViewPresentation,
  mcpToolPresentation,
  planStepsPresentation,
} from "./presentation.js";
import {
  CODEX_GOAL_EXTENSION_KIND,
  type CodexGoalState,
} from "./extension-kinds.js";
import { codexVisibilityMetadata } from "./visibility.js";

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

/**
 * A bb-injected tool the session was constructed with (Q31). The definition
 * carries its presentation once the server resolved one; a definition from
 * before the field existed presents generically.
 */
export interface CodexInjectedTool {
  name: string;
  presentation?: DeltaPresentation;
}

/**
 * The structured classification Codex attached to a retried failure, keyed by
 * `threadId\0turnId`. Codex labels every reconnect attempt with the specific
 * error info (for example `responseStreamDisconnected`) but downgrades the
 * terminal error for the same failure to `other` once its retry budget is
 * exhausted, so the bridge carries the retry-time classification forward.
 */
interface CodexRetryErrorContext {
  errorInfo: CodexErrorInfo;
  failureText: string;
}

interface CodexEventTranslationState {
  rateLimits: CodexRateLimitSnapshot | null;
  /**
   * The bb-injected tools of the session, by name. A `dynamicToolCall` to one
   * of them is a bb tool (`server: "bb"`) and reads the way its definition
   * says; every other dynamic tool call is codex's own.
   */
  injectedToolsByName: Map<string, CodexInjectedTool>;
  retryErrorsByTurnKey: Map<string, CodexRetryErrorContext>;
}

export function createCodexEventTranslationState(): CodexEventTranslationState {
  return {
    rateLimits: null,
    injectedToolsByName: new Map(),
    retryErrorsByTurnKey: new Map(),
  };
}

export function setCodexInjectedTools(
  state: CodexEventTranslationState,
  tools: readonly CodexInjectedTool[],
): void {
  state.injectedToolsByName = new Map(tools.map((tool) => [tool.name, tool]));
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
type CodexErrorParams = CodexErrorEvent["params"];

type CodexItemTranslationResult =
  | {
      kind: "translated";
      shape: DeltaItemShape;
      /** How the row reads (grammar v3); restated on every open and close. */
      presentation: DeltaPresentation;
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
  errorInfo: CodexErrorInfo | null | undefined,
): ProviderErrorInfo | null {
  if (!errorInfo) {
    return null;
  }
  return {
    category: getProviderErrorCategory(errorInfo),
    providerCode: getCodexErrorProviderCode(errorInfo),
    httpStatusCode: getCodexErrorHttpStatusCode(errorInfo),
  };
}

function codexTurnKey(scope: { threadId: string; turnId?: string }): string {
  return `${scope.threadId}\0${scope.turnId ?? ""}`;
}

function takeCodexRetryError(
  state: CodexEventTranslationState,
  scope: { threadId: string; turnId?: string },
): CodexRetryErrorContext | undefined {
  const key = codexTurnKey(scope);
  const retryError = state.retryErrorsByTurnKey.get(key);
  state.retryErrorsByTurnKey.delete(key);
  return retryError;
}

export function clearCodexEventTranslationThreadState(
  state: CodexEventTranslationState,
  threadId: string,
): void {
  const prefix = codexTurnKey({ threadId });
  for (const key of state.retryErrorsByTurnKey.keys()) {
    if (key.startsWith(prefix)) {
      state.retryErrorsByTurnKey.delete(key);
    }
  }
}

/**
 * Codex reports the underlying failure in `additionalDetails` while it is
 * retrying ("Reconnecting... n/m"), then moves the same text to `message` and
 * downgrades `codexErrorInfo` to `other` on the terminal event. Correlate the
 * two by failure text, scoped to the turn, so the terminal error keeps the
 * structured classification without interpreting provider prose.
 */
function resolveCodexErrorInfo(
  state: CodexEventTranslationState,
  params: CodexErrorParams,
): CodexErrorInfo | null | undefined {
  const errorInfo = params.error.codexErrorInfo;
  const failureText = params.error.additionalDetails ?? params.error.message;
  if (params.willRetry === true) {
    if (errorInfo && errorInfo !== "other") {
      state.retryErrorsByTurnKey.set(codexTurnKey(params), {
        errorInfo,
        failureText,
      });
    }
    return errorInfo;
  }
  if (params.willRetry !== false) {
    return errorInfo;
  }
  const retryError = takeCodexRetryError(state, params);
  return errorInfo === "other" && retryError?.failureText === failureText
    ? retryError.errorInfo
    : errorInfo;
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

interface CodexWebItemTranslation {
  shape: DeltaItemShape;
  presentation: DeltaPresentation;
}

function normalizeCodexWebItemShape(
  item: Extract<CodexHandledThreadItem, { type: "webSearch" }>,
): CodexWebItemTranslation | null {
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
      return {
        shape: { type: "webSearch", queries },
        presentation: webSearchPresentation(queries[0]),
      };
    }
    case "openPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return {
        shape: { type: "webFetch", url, pattern: null },
        presentation: webFetchPresentation(url),
      };
    }
    case "findInPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return {
        shape: { type: "webFetch", url, pattern: item.action.pattern ?? null },
        presentation: webFetchPresentation(url),
      };
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

/** Provider-anonymous key for the plan-steps snapshots of a thread. */
const PLAN_STEPS_CHANNEL = "planSteps";

/** The `server` a bb-injected tool call carries (Q31). */
const BB_TOOL_SERVER = "bb";

function isTerminalCodexItemStatus(status: CodexItemStatus): boolean {
  return status !== "inProgress";
}

type CodexCollabAgentToolCall = Extract<
  CodexHandledThreadItem,
  { type: "collabAgentToolCall" }
>;

const COLLAB_DELEGATION_VERBS: Readonly<Record<string, string>> = {
  spawnAgent: "Spawn agent",
  wait: "Wait for agent",
  resumeAgent: "Resume agent",
  sendInput: "Send input to agent",
  closeAgent: "Close agent",
};

/** The delegation's human label: the prompt when the call carries one. */
function collabDelegationLabel(item: CodexCollabAgentToolCall): string {
  if (item.prompt !== null && item.prompt.trim().length > 0) {
    return item.prompt.trim();
  }
  return COLLAB_DELEGATION_VERBS[item.tool] ?? item.tool;
}

/**
 * The child's terminal summary as codex reports it: `agentsStates` maps each
 * agent thread id to its final state (a status string or a structured
 * record). Rendered as one line per agent; absent when codex reported none.
 */
function summarizeCollabAgentsStates(
  agentsStates: Record<string, unknown>,
): string | undefined {
  const lines = Object.entries(agentsStates).map(([agentThreadId, state]) => {
    const rendered = typeof state === "string" ? state : JSON.stringify(state);
    return `${agentThreadId}: ${rendered}`;
  });
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function translateCodexItemShape(
  item: unknown,
  state: CodexEventTranslationState,
): CodexItemTranslationResult {
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
        presentation: AGENT_MESSAGE_PRESENTATION,
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
        presentation: commandPresentation(parsedItem.command),
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
        presentation: fileChangePresentation(
          parsedItem.changes.map((change) => change.path),
        ),
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
          ...(parsedItem.durationMs === null ||
          parsedItem.durationMs === undefined
            ? {}
            : { durationMs: parsedItem.durationMs }),
        },
        presentation: mcpToolPresentation({
          server: parsedItem.server,
          tool: parsedItem.tool,
          args: parsedItem.arguments,
        }),
        ...toolStatusFields(parsedItem.status),
      };
    case "dynamicToolCall": {
      const result = extractDynamicToolCallResult(parsedItem.contentItems);
      const error = buildDynamicToolCallError(parsedItem.success, result);
      // A dynamic tool bb injected at session construction is a bb tool:
      // `server: "bb"` names its origin and its definition says how the row
      // reads, so no tool-name table is needed anywhere downstream.
      const injected = state.injectedToolsByName.get(parsedItem.tool);
      return {
        kind: "translated",
        shape: {
          type: "tool",
          ...(injected === undefined ? {} : { server: BB_TOOL_SERVER }),
          tool: parsedItem.tool,
          ...(parsedItem.arguments === undefined
            ? {}
            : { args: parsedItem.arguments }),
          ...(result === undefined ? {} : { result }),
          ...(error === undefined ? {} : { error }),
          ...(parsedItem.durationMs === null ||
          parsedItem.durationMs === undefined
            ? {}
            : { durationMs: parsedItem.durationMs }),
        },
        presentation:
          injected?.presentation ?? toolPresentation(parsedItem.tool),
        ...toolStatusFields(parsedItem.status),
      };
    }
    case "collabAgentToolCall": {
      const presentation = collabAgentPresentation({
        tool: parsedItem.tool,
        prompt: parsedItem.prompt,
      });
      const childRef = parsedItem.receiverThreadIds[0];
      if (childRef !== undefined && childRef.length > 0) {
        // A collab call that names its child agent IS a delegation to it
        // (grammar v3): spawnAgent/resumeAgent/sendInput with a receiver,
        // and a wait/closeAgent scoped to one agent. The child's own turns
        // link back through the call id as their parentRef.
        return {
          kind: "translated",
          shape: {
            type: "delegation",
            childRef,
            label: collabDelegationLabel(parsedItem),
            background: false,
            ...(isTerminalCodexItemStatus(parsedItem.status)
              ? {
                  summary: summarizeCollabAgentsStates(parsedItem.agentsStates),
                }
              : {}),
          },
          presentation,
          ...toolStatusFields(parsedItem.status),
        };
      }
      // Without a receiver there is no child to delegate to: codex's bare
      // `wait` (wait for every agent) and `closeAgent` stay generic tool
      // calls, presented as the collab verb they are.
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
        presentation,
        ...toolStatusFields(parsedItem.status),
      };
    }
    case "subAgentActivity":
      // The translator handles this statefully so it can correlate the
      // activity with the child turn and close the synthetic delegation row.
      return { kind: "ignored" };
    case "webSearch": {
      if (shouldIgnoreCodexWebItem(parsedItem)) {
        return { kind: "ignored" };
      }
      const translation = normalizeCodexWebItemShape(parsedItem);
      return translation
        ? {
            kind: "translated",
            shape: translation.shape,
            presentation: translation.presentation,
            status: "completed",
            approvalDenied: false,
          }
        : { kind: "unhandled" };
    }
    case "imageView":
      return {
        kind: "translated",
        shape: { type: "imageView", path: parsedItem.path },
        presentation: imageViewPresentation(parsedItem.path),
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
        presentation: REASONING_PRESENTATION,
        status: "completed",
        approvalDenied: false,
      };
    case "plan":
      return {
        kind: "translated",
        shape: { type: "plan", text: parsedItem.text },
        presentation: PLAN_PRESENTATION,
        status: "completed",
        approvalDenied: false,
      };
    case "contextCompaction":
      return {
        kind: "translated",
        shape: { type: "compaction" },
        presentation: COMPACTION_PRESENTATION,
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
      takeCodexRetryError(state, {
        threadId: handledEvent.params.threadId,
        turnId: handledEvent.params.turn.id,
      });
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
          // runtime restarts. Completed and interrupted turns are persisted
          // fork points. Failed turns can be absent from older Codex rollouts,
          // so do not claim a checkpoint for those without equivalent proof.
          ...(status === "completed" || status === "interrupted"
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
    case "thread/goal/updated": {
      // Codex's Goal is codex vocabulary: a `provider-codex/goal` thread
      // state snapshot (latest wins), not a core event.
      const goal: CodexGoalState = {
        objective: handledEvent.params.goal.objective,
        status: handledEvent.params.goal.status,
        tokenBudget: handledEvent.params.goal.tokenBudget,
        tokensUsed: handledEvent.params.goal.tokensUsed,
        timeUsedSeconds: handledEvent.params.goal.timeUsedSeconds,
      };
      return [
        {
          kind: "extension.state",
          extensionKind: CODEX_GOAL_EXTENSION_KIND,
          payload: goal,
        },
      ];
    }
    case "thread/goal/cleared":
      return [
        {
          kind: "extension.state",
          extensionKind: CODEX_GOAL_EXTENSION_KIND,
          payload: null,
        },
      ];
    case "item/started":
    case "item/completed": {
      const translation = translateCodexItemShape(
        handledEvent.params.item,
        state,
      );
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
            presentation: translation.presentation,
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
          presentation: translation.presentation,
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
    case "thread/tokenUsage/updated": {
      // Codex reports exact cumulative totals, so the `usage` delta forwards
      // them verbatim; its `last.totalTokens` is also the context-window
      // reading, which rides the `contextWindow` delta beside it (both scoped
      // to the same vouched turn).
      const { tokenUsage, turnId } = handledEvent.params;
      return [
        {
          kind: "usage",
          total: {
            totalTokens: tokenUsage.total.totalTokens,
            inputTokens: tokenUsage.total.inputTokens,
            cachedInputTokens: tokenUsage.total.cachedInputTokens,
            outputTokens: tokenUsage.total.outputTokens,
            reasoningOutputTokens: tokenUsage.total.reasoningOutputTokens,
          },
          last: {
            totalTokens: tokenUsage.last.totalTokens,
            inputTokens: tokenUsage.last.inputTokens,
            cachedInputTokens: tokenUsage.last.cachedInputTokens,
            outputTokens: tokenUsage.last.outputTokens,
            reasoningOutputTokens: tokenUsage.last.reasoningOutputTokens,
          },
          modelContextWindow: tokenUsage.modelContextWindow,
          providerTurnId: turnId,
        },
        {
          kind: "contextWindow",
          used: tokenUsage.last.totalTokens,
          size: tokenUsage.modelContextWindow,
          estimated: false,
          attach: "currentOrLast",
          providerTurnId: turnId,
        },
      ];
    }
    case "turn/plan/updated": {
      // Codex's `update_plan` surfaces only as this turn-level notification,
      // so each update is one settled `planSteps` snapshot (grammar v3): a
      // channel-keyed close mints a fresh item per snapshot, and the latest
      // one supersedes the rest — the same shape as a Claude TodoWrite call.
      const steps = handledEvent.params.plan.map((step) => ({
        step: step.step,
        status:
          step.status === "inProgress" ? ("active" as const) : step.status,
      }));
      const explanation = handledEvent.params.explanation;
      return [
        {
          kind: "item.close",
          key: { channel: PLAN_STEPS_CHANNEL },
          status: "completed",
          item: {
            type: "planSteps",
            steps,
            ...(explanation ? { explanation } : {}),
          },
          presentation: planStepsPresentation({
            steps,
            explanation: explanation ?? null,
          }),
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    }
    case "turn/diff/updated":
      return [
        {
          kind: "turn.diff",
          diff: handledEvent.params.diff,
          providerTurnId: handledEvent.params.turnId,
        },
      ];
    case "error": {
      const errorInfo = toProviderErrorInfo(
        resolveCodexErrorInfo(state, handledEvent.params),
      );
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
