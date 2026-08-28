import {
  type ProviderErrorCategory,
  type ProviderErrorInfo,
  type ProviderRateLimitState,
  type ProviderRateLimitStatus,
  type ProviderRateLimitWindow,
  providerRawEventSchema,
  type DeltaPresentation,
  type ProviderRawEvent,
  type ThreadDelta,
  type ThreadEventItemStatus,
  type ThreadEventTurnStatus,
  type JsonRpcMessage,
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
import { z } from "zod";

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export interface CodexInjectedTool {
  name: string;
  presentation?: DeltaPresentation;
}

interface CodexRetryErrorContext {
  errorInfo: CodexErrorInfo;
  failureText: string;
}

interface CodexEventTranslationState {
  rateLimits: CodexRateLimitSnapshot | null;
  injectedToolsByName: Map<string, CodexInjectedTool>;
  retryErrorsByTurnKey: Map<string, CodexRetryErrorContext>;
}

type DeltaItem = Extract<ThreadDelta, { kind: "item.open" }>["item"];

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
    spendControlReached: update.spendControlReached ?? null,
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
  const isSpendControlBlocked = snapshot.spendControlReached === true;

  return {
    providerId: "codex",
    status: isSpendControlBlocked ? "blocked" : status,
    kind: isSpendControlBlocked ? "spend-control" : kind,
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
      item: DeltaItem;
      presentation: DeltaPresentation;
      status: ThreadEventItemStatus;
      approvalDenied: boolean;
    }
  | { kind: "ignored" }
  | { kind: "unhandled" };

function getCodexErrorProviderCode(errorInfo: CodexErrorInfo): string {
  switch (errorInfo) {
    case "contextWindowExceeded":
    case "sessionBudgetExceeded":
    case "usageLimitExceeded":
    case "serverOverloaded":
    case "cyberPolicy":
    case "misalignmentPolicyViolation":
    case "internalServerError":
    case "unauthorized":
    case "badRequest":
    case "threadRollbackFailed":
    case "sandboxError":
    case "other":
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
  switch (errorInfo) {
    case "contextWindowExceeded":
    case "sessionBudgetExceeded":
    case "usageLimitExceeded":
    case "serverOverloaded":
    case "cyberPolicy":
    case "misalignmentPolicyViolation":
    case "internalServerError":
    case "unauthorized":
    case "badRequest":
    case "threadRollbackFailed":
    case "sandboxError":
    case "other":
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
  switch (errorInfo) {
    case "contextWindowExceeded":
      return "context-window-exceeded";
    case "sessionBudgetExceeded":
      return "budget-exceeded";
    case "usageLimitExceeded":
      return "rate-limit";
    case "serverOverloaded":
      return "overloaded";
    case "cyberPolicy":
    case "misalignmentPolicyViolation":
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
  const fallback: ProviderRawEvent = {
    jsonrpc: "2.0",
    method: rawEvent.method,
    params: {
      serializationError:
        "Provider raw event params were not JSON-serializable.",
    },
  };
  if (rawEvent.id !== undefined) {
    fallback.id = rawEvent.id;
  }
  return fallback;
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

  const delta: Extract<ThreadDelta, { kind: "unhandled" }> = {
    kind: "unhandled",
    raw: toRawEvent(args.rawEvent),
    rawType: args.rawType ?? description.kind,
    vouchedTurn: args.providerTurnId !== undefined,
  };
  if (args.providerTurnId !== undefined) {
    delta.providerTurnId = args.providerTurnId;
  }
  if (args.parentRef !== undefined) {
    delta.parentRef = args.parentRef;
  }
  return [delta];
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
): string | undefined {
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
  result: string | undefined,
): string | undefined {
  if (success !== false) {
    return undefined;
  }
  if (result !== undefined && result.trim().length > 0) {
    return result;
  }
  return "Dynamic tool call failed";
}

function collectNonEmptyStrings(
  values: Array<string | null | undefined>,
): string[] {
  return values.filter(
    (value): value is string =>
      value !== null && value !== undefined && value.length > 0,
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
  item: DeltaItem;
  presentation: DeltaPresentation;
}

function normalizeCodexWebItem(
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
        item: { type: "webSearch", queries },
        presentation: webSearchPresentation(queries[0]),
      };
    }
    case "openPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return {
        item: { type: "webFetch", url, pattern: null },
        presentation: webFetchPresentation(url),
      };
    }
    case "findInPage": {
      const url = normalizeCodexUrl({ actionUrl: item.action.url });
      if (!url) {
        return null;
      }
      return {
        item: { type: "webFetch", url, pattern: item.action.pattern ?? null },
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

interface CodexToolStatusFields {
  status: ThreadEventItemStatus;
  approvalDenied: boolean;
}

function toolStatusFields(status: CodexItemStatus): CodexToolStatusFields {
  return {
    status: toItemStatus(status),
    approvalDenied: status === "declined",
  };
}

const PLAN_STEPS_CHANNEL = "planSteps";

const BB_TOOL_SERVER = "bb";

function isTerminalCodexItemStatus(status: CodexItemStatus): boolean {
  return status !== "inProgress";
}

type CodexCollabAgentToolCall = Extract<
  CodexHandledThreadItem,
  { type: "collabAgentToolCall" }
>;

const COLLAB_DELEGATION_VERBS = new Map<string, string>([
  ["spawnAgent", "Spawn agent"],
  ["wait", "Wait for agent"],
  ["resumeAgent", "Resume agent"],
  ["sendInput", "Send input to agent"],
  ["closeAgent", "Close agent"],
]);

function collabDelegationLabel(item: CodexCollabAgentToolCall): string {
  if (item.prompt !== null && item.prompt.trim().length > 0) {
    return item.prompt.trim();
  }
  return COLLAB_DELEGATION_VERBS.get(item.tool) ?? item.tool;
}

const codexAgentStatesSchema = z.record(z.string(), z.json());
type CodexAgentStates = z.infer<typeof codexAgentStatesSchema>;

function summarizeCollabAgentsStates(
  agentsStates: CodexAgentStates,
): string | undefined {
  const lines = Object.entries(agentsStates).map(([agentThreadId, state]) => {
    const parsedString = z.string().safeParse(state);
    const rendered = parsedString.success
      ? parsedString.data
      : JSON.stringify(state);
    return `${agentThreadId}: ${rendered}`;
  });
  return lines.length > 0 ? lines.join("\n") : undefined;
}

type CodexCommandExecutionItem = Extract<
  CodexHandledThreadItem,
  { type: "commandExecution" }
>;

function commandItem(
  source: CodexCommandExecutionItem,
): Extract<DeltaItem, { type: "command" }> {
  const item: Extract<DeltaItem, { type: "command" }> = {
    type: "command",
    command: source.command,
    cwd: source.cwd,
  };
  if (source.aggregatedOutput !== null) {
    item.aggregatedOutput = source.aggregatedOutput;
  }
  if (source.exitCode !== null) {
    item.exitCode = source.exitCode;
  }
  if (source.durationMs !== null) {
    item.durationMs = source.durationMs;
  }
  return item;
}

type CodexFileChangeItem = Extract<
  CodexHandledThreadItem,
  { type: "fileChange" }
>;

function fileChangeItem(
  source: CodexFileChangeItem,
): Extract<DeltaItem, { type: "fileChange" }> {
  const changes = source.changes.map((change) => {
    const translated: Extract<
      DeltaItem,
      { type: "fileChange" }
    >["changes"][number] = {
      path: change.path,
      kind: change.kind.type,
    };
    if (change.kind.type === "update" && change.kind.move_path) {
      translated.movePath = change.kind.move_path;
    }
    if (change.diff) {
      translated.diff = change.diff;
    }
    return translated;
  });
  return { type: "fileChange", changes };
}

type CodexMcpToolCallItem = Extract<
  CodexHandledThreadItem,
  { type: "mcpToolCall" }
>;

function mcpToolItem(
  source: CodexMcpToolCallItem,
): Extract<DeltaItem, { type: "tool" }> {
  const item: Extract<DeltaItem, { type: "tool" }> = {
    type: "tool",
    server: source.server,
    tool: source.tool,
  };
  if (source.arguments !== undefined) {
    item.args = source.arguments;
  }
  if (source.error?.message !== undefined) {
    item.error = source.error.message;
  }
  if (source.durationMs !== null && source.durationMs !== undefined) {
    item.durationMs = source.durationMs;
  }
  return item;
}

type CodexDynamicToolCallItem = Extract<
  CodexHandledThreadItem,
  { type: "dynamicToolCall" }
>;

function dynamicToolItem(
  source: CodexDynamicToolCallItem,
  injected: CodexInjectedTool | undefined,
  result: string | undefined,
  error: string | undefined,
): Extract<DeltaItem, { type: "tool" }> {
  const item: Extract<DeltaItem, { type: "tool" }> = {
    type: "tool",
    tool: source.tool,
  };
  if (injected !== undefined) {
    item.server = BB_TOOL_SERVER;
  }
  if (source.arguments !== undefined) {
    item.args = source.arguments;
  }
  if (result !== undefined) {
    item.result = result;
  }
  if (error !== undefined) {
    item.error = error;
  }
  if (source.durationMs !== null && source.durationMs !== undefined) {
    item.durationMs = source.durationMs;
  }
  return item;
}

interface CodexCollabToolArgs {
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt?: string;
  model?: string;
  reasoningEffort?: string;
}

function delegationItem(
  source: CodexCollabAgentToolCall,
  childRef: string,
  agentsStates: CodexAgentStates,
): Extract<DeltaItem, { type: "delegation" }> {
  const item: Extract<DeltaItem, { type: "delegation" }> = {
    type: "delegation",
    childRef,
    label: collabDelegationLabel(source),
    background: false,
  };
  if (isTerminalCodexItemStatus(source.status)) {
    const summary = summarizeCollabAgentsStates(agentsStates);
    if (summary !== undefined) {
      item.summary = summary;
    }
  }
  return item;
}

function collabToolItem(
  source: CodexCollabAgentToolCall,
  agentsStates: CodexAgentStates,
): Extract<DeltaItem, { type: "tool" }> {
  const args: CodexCollabToolArgs = {
    senderThreadId: source.senderThreadId,
    receiverThreadIds: source.receiverThreadIds,
  };
  if (source.prompt) {
    args.prompt = source.prompt;
  }
  if (source.model) {
    args.model = source.model;
  }
  if (source.reasoningEffort) {
    args.reasoningEffort = source.reasoningEffort;
  }
  return {
    type: "tool",
    tool: source.tool,
    args,
    result: agentsStates,
  };
}

function translateCodexItem(
  item: CodexHandledThreadItem,
  state: CodexEventTranslationState,
): CodexItemTranslationResult {
  const parsedItem = item;
  switch (parsedItem.type) {
    case "agentMessage":
      return {
        kind: "translated",
        item: { type: "agentMessage", text: parsedItem.text },
        presentation: AGENT_MESSAGE_PRESENTATION,
        status: "completed",
        approvalDenied: false,
      };
    case "userMessage":
      return { kind: "ignored" };
    case "commandExecution":
      return {
        kind: "translated",
        item: commandItem(parsedItem),
        presentation: commandPresentation(parsedItem.command),
        ...toolStatusFields(parsedItem.status),
      };
    case "fileChange":
      return {
        kind: "translated",
        item: fileChangeItem(parsedItem),
        presentation: fileChangePresentation(
          parsedItem.changes.map((change) => change.path),
        ),
        ...toolStatusFields(parsedItem.status),
      };
    case "mcpToolCall": {
      const parsedArguments = z.json().safeParse(parsedItem.arguments);
      return {
        kind: "translated",
        item: mcpToolItem(parsedItem),
        presentation: mcpToolPresentation({
          server: parsedItem.server,
          tool: parsedItem.tool,
          args: parsedArguments.success ? parsedArguments.data : null,
        }),
        ...toolStatusFields(parsedItem.status),
      };
    }
    case "dynamicToolCall": {
      const result = extractDynamicToolCallResult(parsedItem.contentItems);
      const error = buildDynamicToolCallError(parsedItem.success, result);
      const injected = state.injectedToolsByName.get(parsedItem.tool);
      return {
        kind: "translated",
        item: dynamicToolItem(parsedItem, injected, result, error),
        presentation:
          injected?.presentation ?? toolPresentation(parsedItem.tool),
        ...toolStatusFields(parsedItem.status),
      };
    }
    case "collabAgentToolCall": {
      const agentsStates = codexAgentStatesSchema.safeParse(
        parsedItem.agentsStates,
      );
      if (!agentsStates.success) {
        return { kind: "unhandled" };
      }
      const presentation = collabAgentPresentation({
        tool: parsedItem.tool,
        prompt: parsedItem.prompt,
      });
      const childRef = parsedItem.receiverThreadIds[0];
      if (childRef !== undefined && childRef.length > 0) {
        return {
          kind: "translated",
          item: delegationItem(parsedItem, childRef, agentsStates.data),
          presentation,
          ...toolStatusFields(parsedItem.status),
        };
      }
      return {
        kind: "translated",
        item: collabToolItem(parsedItem, agentsStates.data),
        presentation,
        ...toolStatusFields(parsedItem.status),
      };
    }
    case "subAgentActivity":
      return { kind: "ignored" };
    case "webSearch": {
      if (shouldIgnoreCodexWebItem(parsedItem)) {
        return { kind: "ignored" };
      }
      const translation = normalizeCodexWebItem(parsedItem);
      return translation
        ? {
            kind: "translated",
            item: translation.item,
            presentation: translation.presentation,
            status: "completed",
            approvalDenied: false,
          }
        : { kind: "unhandled" };
    }
    case "imageView":
      return {
        kind: "translated",
        item: { type: "imageView", path: parsedItem.path },
        presentation: imageViewPresentation(parsedItem.path),
        status: "completed",
        approvalDenied: false,
      };
    case "reasoning":
      return {
        kind: "translated",
        item: {
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
        item: { type: "plan", text: parsedItem.text },
        presentation: PLAN_PRESENTATION,
        status: "completed",
        approvalDenied: false,
      };
    case "contextCompaction":
      return {
        kind: "translated",
        item: { type: "compaction" },
        presentation: COMPACTION_PRESENTATION,
        status: "completed",
        approvalDenied: false,
      };
    default:
      return assertNever(parsedItem);
  }
}

interface CodexTranslationEvent {
  jsonrpc?: "2.0";
  method?: string;
  params?: object;
}

export function translateCodexEventToDeltas(
  event: CodexTranslationEvent,
  state: CodexEventTranslationState,
): ThreadDelta[] {
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    return [];
  }

  const rawEvent: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: envelope.data.method,
  };
  if (envelope.data.params) {
    const parsedParams = z.json().safeParse(envelope.data.params);
    rawEvent.params = parsedParams.success
      ? parsedParams.data
      : {
          serializationError:
            "Provider raw event params were not JSON-serializable.",
        };
  }

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
      const delta: Extract<ThreadDelta, { kind: "turn.boundary" }> = {
        kind: "turn.boundary",
        providerTurnId: handledEvent.params.turn.id,
        status,
      };
      if (handledEvent.params.turn.error?.message) {
        delta.error = { message: handledEvent.params.turn.error.message };
      }
      if (status === "completed" || status === "interrupted") {
        delta.providerCheckpointId = handledEvent.params.turn.id;
      }
      return [delta];
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
      const parsedItem = codexHandledThreadItemSchema.safeParse(
        handledEvent.params.item,
      );
      const translation = parsedItem.success
        ? translateCodexItem(parsedItem.data, state)
        : { kind: "unhandled" as const };
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
            item: translation.item,
            presentation: translation.presentation,
            providerTurnId: handledEvent.params.turnId,
          },
        ];
      }
      const delta: Extract<ThreadDelta, { kind: "item.close" }> = {
        kind: "item.close",
        key,
        status: translation.status,
        item: translation.item,
        presentation: translation.presentation,
        providerTurnId: handledEvent.params.turnId,
      };
      if (translation.approvalDenied) {
        delta.approvalStatus = "denied";
      }
      return [delta];
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
    case "item/mcpToolCall/progress": {
      const delta: Extract<ThreadDelta, { kind: "item.progress" }> = {
        kind: "item.progress",
        key: { providerItemId: handledEvent.params.itemId },
        providerTurnId: handledEvent.params.turnId,
      };
      if (handledEvent.params.message) {
        delta.message = handledEvent.params.message;
      }
      return [delta];
    }
    case "thread/tokenUsage/updated": {
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
      const steps = handledEvent.params.plan.map((step) => ({
        step: step.step,
        status:
          step.status === "inProgress" ? ("active" as const) : step.status,
      }));
      const explanation = handledEvent.params.explanation;
      const item: Extract<DeltaItem, { type: "planSteps" }> = {
        type: "planSteps",
        steps,
      };
      if (explanation) {
        item.explanation = explanation;
      }
      return [
        {
          kind: "item.close",
          key: { channel: PLAN_STEPS_CHANNEL },
          status: "completed",
          item,
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
      const delta: Extract<ThreadDelta, { kind: "provider.error" }> = {
        kind: "provider.error",
        message: "Provider error",
        detail: handledEvent.params.error.additionalDetails
          ? `${handledEvent.params.error.message}\n${handledEvent.params.error.additionalDetails}`
          : handledEvent.params.error.message,
      };
      if (handledEvent.params.willRetry !== undefined) {
        delta.willRetry = handledEvent.params.willRetry;
      }
      if (errorInfo) {
        delta.errorInfo = errorInfo;
      }
      if (handledEvent.params.turnId !== undefined) {
        delta.providerTurnId = handledEvent.params.turnId;
      } else {
        delta.threadScoped = true;
      }
      return [delta];
    }
    case "deprecationNotice": {
      const delta: Extract<ThreadDelta, { kind: "provider.warning" }> = {
        kind: "provider.warning",
        category: "deprecation",
        summary: handledEvent.params.summary,
      };
      if (handledEvent.params.details) {
        delta.details = handledEvent.params.details;
      }
      return [delta];
    }
    case "configWarning": {
      const delta: Extract<ThreadDelta, { kind: "provider.warning" }> = {
        kind: "provider.warning",
        category: "config",
        summary: handledEvent.params.summary,
      };
      if (handledEvent.params.details) {
        delta.details = handledEvent.params.details;
      }
      return [delta];
    }
    default:
      return assertNever(handledEvent);
  }
}
