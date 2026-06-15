/**
 * Claude Code provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the Claude Code SDK bridge
 * process. The bridge communicates via JSON-RPC over stdin/stdout. The adapter
 * owns event translation: it takes raw `SDKMessage` from the Claude Agent SDK
 * and produces `ThreadEvent[]`.
 */

import { getBuiltInAgentProviderInfo } from "@bb/agent-providers";
import type {
  ApprovalPendingInteractionPayload,
  PendingInteractionApprovalDecision,
  PendingInteractionApprovalSubject,
  PendingInteractionGrantedPermissionProfile,
  PendingInteractionUserQuestionQuestion,
  ThreadEvent,
  ThreadEventItem,
  UserQuestionPendingInteractionPayload,
  UserQuestionPendingInteractionResolution,
  ClaudeTaskToolOutput,
} from "@bb/domain";
import {
  claudeTaskToolNameSchema,
  claudeTaskToolOutputSchema,
  jsonValueSchema,
  threadScope,
} from "@bb/domain";
import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isUserQuestionPendingInteractionPayload,
  isUserQuestionPendingInteractionResolution,
} from "@bb/domain";
import { decodeNormalizedProviderToolCallRequest } from "../shared/provider-tool-call-contract.js";
import { resolveAdapterPermissionPolicy } from "../shared/permission-policy.js";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import { bashArgsSchema } from "../shared/tool-arg-schemas.js";
import {
  buildEditDiff,
  buildShellEnvironmentPolicyConfig,
  extractResultText,
  toOptionalRecord,
  toOptionalString,
  withParentToolCallId,
} from "../shared/adapter-utils.js";
import {
  buildAcceptedUserMessageEvent,
  drainAcceptedUserMessages,
  queueAcceptedUserMessage,
} from "../shared/accepted-user-messages.js";
import {
  createProviderTurnStateRegistry,
  finishOpenProviderTurn,
  type EnsureProviderTurnStartedArgs,
} from "../shared/turn-state.js";
import {
  buildUnhandledProviderEvents,
  createUnhandledProviderEvent,
} from "../shared/provider-unhandled-event.js";
import { UNSTAMPED_THREAD_ID } from "../shared/unstamped-thread-id.js";
import { buildScopedProviderErrorEvents } from "../shared/provider-error-events.js";
import { parseAvailableModelList } from "../shared/available-models.js";
import {
  errorEnvelopeSchema,
  jsonRpcEnvelopeSchema,
  sdkMessageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
} from "../shared/json-rpc-envelope.js";
import type {
  AdapterCommand,
  DecodedInteractiveRequest,
  DecodedToolCallRequest,
  ProviderCommandPlan,
  ProviderExecutionContext,
  ProviderTranslationContext,
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "../provider-adapter.js";
import { noPreparedProviderCommandDispatch } from "../provider-adapter.js";
import {
  type JsonRpcMessage,
  type ProviderInboundRequest,
  type ProviderRuntimeEvent,
  ProviderResponseEncodeError,
} from "../runtime-json-rpc.js";
import type { AgentRuntimeSkillRoot } from "../types.js";
import {
  buildClaudeSessionPermissionUpdates,
  CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD,
  CLAUDE_USER_QUESTION_REQUEST_METHOD,
  isClaudeConcreteFileChangeToolName,
  type ClaudeUserQuestion,
  type ClaudeUserQuestionOutput,
  type ClaudeUserQuestionRequestParams,
  type ClaudePermissionRequestApprovalParams,
  claudePermissionRequestApprovalParamsSchema,
  claudeUserQuestionRequestParamsSchema,
  toClaudePermissionMode,
} from "./interactive-contract.js";
import {
  claudeFileEditArgsSchema,
  claudeWebFetchArgsSchema,
  claudeWebSearchArgsSchema,
  type ClaudeToolUseResult,
  type ClaudeFileEditArgs,
  type ClaudeWebFetchArgs,
  type ClaudeWebSearchArgs,
} from "./schemas.js";
import { claudeCodeVisibilityMetadata } from "./visibility.js";
import {
  extractClaudeCommandExecutionOutput,
  getNestedParentToolUseId,
  resolveClaudeModelContextWindowHint,
} from "./sdk-extraction.js";
import {
  translateClaudeSdkMessage,
  type ClaudeToolResultTranslationInput,
  type ClaudeToolUseTranslationInput,
  type ClaudeTurnState,
  type ClaudeUnexpectedSdkEventArgs,
} from "./translate-message.js";
import {
  buildInterruptedClaudeTaskEvents,
  hasOpenClaudeBackgroundTasks,
} from "./task-translation.js";

type ClaudePendingFileChangeItem = Extract<
  ThreadEventItem,
  { type: "fileChange" }
>;

interface ClaudeBashCommand {
  command: string;
  cwd: string | null;
}

interface ClaudeNormalizedWebFetch {
  url: string;
  prompt: string | null;
}

interface AdditionalWorkspaceWriteRootsParams {
  additionalWorkspaceWriteRoots: string[];
}

interface ClaudeLocalPluginConfig {
  type: "local";
  path: string;
}

interface ClaudeSkillConfigParams {
  plugins: ClaudeLocalPluginConfig[];
}

interface ClaudeSkillConfigEntryArgs {
  skillRoot: AgentRuntimeSkillRoot;
}

function buildAdditionalWorkspaceWriteRootsParams(
  roots: readonly string[],
): AdditionalWorkspaceWriteRootsParams | undefined {
  return roots.length > 0
    ? { additionalWorkspaceWriteRoots: [...roots] }
    : undefined;
}

function buildClaudeSkillConfigEntry(
  args: ClaudeSkillConfigEntryArgs,
): ClaudeLocalPluginConfig {
  if (args.skillRoot.providerId !== "claude-code") {
    throw new Error(
      `Claude Code cannot configure ${args.skillRoot.providerId} skill root "${args.skillRoot.id}".`,
    );
  }
  return {
    type: "local",
    path: args.skillRoot.localPluginPath,
  };
}

/**
 * Injected skill roots load as local plugins only. Never pass the SDK `skills`
 * option here: it is a session-wide allowlist, so listing the injected skills
 * would hide and reject every other skill the user has installed (~/.claude,
 * plugins, built-ins). Plugin skills are enabled by CLI defaults.
 */
function buildClaudeSkillConfigParams(
  skillRoots: ProviderExecutionContext["skillRoots"],
): ClaudeSkillConfigParams | undefined {
  if (!skillRoots || skillRoots.length === 0) {
    return undefined;
  }

  return {
    plugins: skillRoots.map((skillRoot) =>
      buildClaudeSkillConfigEntry({ skillRoot }),
    ),
  };
}

function parseClaudeBashCommand(input: unknown): ClaudeBashCommand | null {
  const parsed = bashArgsSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const command = toOptionalString(parsed.data.command);
  if (!command) {
    return null;
  }
  return {
    command,
    cwd: toOptionalString(parsed.data.cwd) ?? null,
  };
}

function getClaudeFileEditPath(args: ClaudeFileEditArgs): string | null {
  return args.file_path ?? args.path ?? null;
}

function buildClaudeFileChangeItem(
  args: ClaudeFileEditArgs,
): ClaudePendingFileChangeItem | null {
  const filePath = getClaudeFileEditPath(args);
  if (!filePath) {
    return null;
  }
  const newText = args.new_string ?? args.content;

  const diff = buildEditDiff(filePath, args.old_string, newText);

  return {
    type: "fileChange",
    id: "",
    changes: [
      {
        path: filePath,
        kind: args.old_string === undefined ? "add" : "update",
        ...(diff ? { diff } : {}),
      },
    ],
    status: "pending",
    approvalStatus: null,
  };
}

function normalizeClaudeWebSearchArgs(
  args: ClaudeWebSearchArgs,
): string[] | null {
  const query = toOptionalString(args.query);
  if (!query) {
    return null;
  }
  return [query];
}

function normalizeClaudeWebFetchArgs(
  args: ClaudeWebFetchArgs,
): ClaudeNormalizedWebFetch | null {
  const url = toOptionalString(args.url);
  if (!url) {
    return null;
  }
  return {
    url,
    prompt: toOptionalString(args.prompt) ?? null,
  };
}

function hasClaudeSessionPermissionUpdate(
  args: ClaudePermissionRequestApprovalParams,
): boolean {
  return (
    buildClaudeSessionPermissionUpdates({
      permissions: args.permissions,
      toolName: args.toolName,
    }) !== undefined
  );
}

function buildClaudeApprovalAvailableDecisions(
  args: ClaudePermissionRequestApprovalParams,
): PendingInteractionApprovalDecision[] {
  return hasClaudeSessionPermissionUpdate(args)
    ? ["allow_once", "allow_for_session", "deny"]
    : ["allow_once", "deny"];
}

function buildClaudeApprovalSubject(
  args: ClaudePermissionRequestApprovalParams,
): PendingInteractionApprovalSubject {
  if (args.toolName === "Bash") {
    const bashCommand = parseClaudeBashCommand(args.input);
    if (bashCommand) {
      return {
        kind: "command",
        itemId: args.itemId,
        command: bashCommand.command,
        cwd: bashCommand.cwd,
        actions: [
          {
            type: "unknown",
            command: bashCommand.command,
          },
        ],
        sessionGrant: args.permissions,
      };
    }
  }

  if (isClaudeConcreteFileChangeToolName(args.toolName)) {
    const parsed = claudeFileEditArgsSchema.safeParse(args.input);
    if (parsed.success && getClaudeFileEditPath(parsed.data)) {
      return {
        kind: "file_change",
        itemId: args.itemId,
        writeScope: null,
        sessionGrant: args.permissions,
      };
    }
  }

  return {
    kind: "permission_grant",
    itemId: args.itemId,
    toolName: args.toolName,
    permissions: args.permissions,
  };
}

function buildClaudeUserQuestionId(
  itemId: string,
  questionIndex: number,
): string {
  return `${itemId}:question-${questionIndex + 1}`;
}

function buildClaudeUserQuestionOptionValue(
  questionId: string,
  optionIndex: number,
): string {
  return `${questionId}:option-${optionIndex + 1}`;
}

function buildClaudeUserQuestionPayload(
  args: ClaudeUserQuestionRequestParams,
): UserQuestionPendingInteractionPayload {
  return {
    kind: "user_question",
    questions: args.questions.map((question, questionIndex) => {
      const questionId = buildClaudeUserQuestionId(args.itemId, questionIndex);
      return {
        id: questionId,
        prompt: question.question,
        shortLabel: question.header,
        multiSelect: question.multiSelect,
        options: question.options.map((option, optionIndex) => ({
          value: buildClaudeUserQuestionOptionValue(questionId, optionIndex),
          label: option.label,
          description: option.description,
        })),
        allowFreeText: true,
      };
    }),
  };
}

function buildClaudeUserQuestion(
  question: PendingInteractionUserQuestionQuestion,
): ClaudeUserQuestion {
  if (!question.options || question.options.length === 0) {
    throw new ProviderResponseEncodeError(
      `User question '${question.id}' has no options to return to Claude`,
    );
  }
  return {
    question: question.prompt,
    header: question.shortLabel ?? question.prompt.slice(0, 12),
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description ?? option.label,
    })),
    multiSelect: question.multiSelect,
  };
}

function buildClaudeUserQuestionAnswerText(
  question: PendingInteractionUserQuestionQuestion,
  resolution: UserQuestionPendingInteractionResolution,
): string {
  const answer = resolution.answers[question.id];
  if (!answer) {
    throw new ProviderResponseEncodeError(
      `Missing answer for user question '${question.id}'`,
    );
  }
  const options = question.options ?? [];
  const selectedLabels = answer.selected.map((selectedValue) => {
    const option = options.find(
      (candidate) => candidate.value === selectedValue,
    );
    if (!option) {
      throw new ProviderResponseEncodeError(
        `Unknown selected option '${selectedValue}' for user question '${question.id}'`,
      );
    }
    return option.label;
  });
  if (selectedLabels.length > 0) {
    const selectedText = selectedLabels.join(", ");
    return answer.freeText
      ? `${selectedText}; ${answer.freeText}`
      : selectedText;
  }
  if (answer.freeText) {
    return answer.freeText;
  }
  throw new ProviderResponseEncodeError(
    `Answer for user question '${question.id}' is empty`,
  );
}

function buildClaudeUserQuestionAnnotations(
  payload: UserQuestionPendingInteractionPayload,
  resolution: UserQuestionPendingInteractionResolution,
): ClaudeUserQuestionOutput["annotations"] {
  const annotations: NonNullable<ClaudeUserQuestionOutput["annotations"]> = {};
  for (const question of payload.questions) {
    const answer = resolution.answers[question.id];
    if (answer && answer.selected.length > 0 && answer.freeText !== undefined) {
      annotations[question.prompt] = { notes: answer.freeText };
    }
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

function validateUniqueClaudeUserQuestionPrompts(
  payload: UserQuestionPendingInteractionPayload,
): void {
  const prompts = new Set<string>();
  for (const question of payload.questions) {
    if (prompts.has(question.prompt)) {
      throw new ProviderResponseEncodeError(
        `Claude user-question prompts must be unique; duplicate prompt '${question.prompt}'`,
      );
    }
    prompts.add(question.prompt);
  }
}

function buildClaudeUserQuestionOutput(
  payload: UserQuestionPendingInteractionPayload,
  resolution: UserQuestionPendingInteractionResolution,
): ClaudeUserQuestionOutput {
  validateUniqueClaudeUserQuestionPrompts(payload);
  const answers: ClaudeUserQuestionOutput["answers"] = {};
  for (const question of payload.questions) {
    answers[question.prompt] = buildClaudeUserQuestionAnswerText(
      question,
      resolution,
    );
  }
  const annotations = buildClaudeUserQuestionAnnotations(payload, resolution);
  return {
    questions: payload.questions.map(buildClaudeUserQuestion),
    answers,
    ...(annotations ? { annotations } : {}),
  };
}

function resolveClaudeGrantedPermissions(
  grantedPermissions: PendingInteractionGrantedPermissionProfile | null,
): PendingInteractionGrantedPermissionProfile {
  if (grantedPermissions === null) {
    throw new ProviderResponseEncodeError(
      "Session approval resolution must include granted permissions",
    );
  }

  return grantedPermissions;
}

function getClaudePermissionUpdateToolName(
  payload: ApprovalPendingInteractionPayload,
): string | null {
  switch (payload.subject.kind) {
    case "command":
      return "Bash";
    case "file_change":
      return null;
    case "permission_grant":
      return payload.subject.toolName;
  }
}

function translateClaudeToolUseItem(
  input: ClaudeToolUseTranslationInput,
): ThreadEventItem {
  const toolArguments = toOptionalRecord(input.args);
  const baseToolCall = {
    type: "toolCall" as const,
    id: input.callId,
    tool: input.toolName,
    ...(toolArguments ? { arguments: toolArguments } : {}),
    status: "pending" as const,
  };

  switch (input.toolName) {
    case "Bash": {
      const bashCommand = parseClaudeBashCommand(input.args);
      if (!bashCommand) {
        return withParentToolCallId(baseToolCall, input.parentToolCallId);
      }
      return withParentToolCallId(
        {
          type: "commandExecution",
          id: input.callId,
          command: bashCommand.command,
          cwd: bashCommand.cwd ?? "",
          status: "pending",
          approvalStatus: null,
        },
        input.parentToolCallId,
      );
    }
    case "Edit":
    case "Write": {
      const parsed = claudeFileEditArgsSchema.safeParse(input.args);
      if (!parsed.success) {
        return withParentToolCallId(baseToolCall, input.parentToolCallId);
      }
      const fileChangeItem = buildClaudeFileChangeItem(parsed.data);
      if (!fileChangeItem) {
        return withParentToolCallId(
          {
            ...baseToolCall,
            arguments: parsed.data,
          },
          input.parentToolCallId,
        );
      }
      return withParentToolCallId(
        {
          ...fileChangeItem,
          id: input.callId,
        },
        input.parentToolCallId,
      );
    }
    case "WebSearch":
    case "WebFetch": {
      if (input.toolName === "WebSearch") {
        const parsed = claudeWebSearchArgsSchema.safeParse(input.args);
        if (!parsed.success) {
          return withParentToolCallId(baseToolCall, input.parentToolCallId);
        }
        const normalized = normalizeClaudeWebSearchArgs(parsed.data);
        if (!normalized) {
          return withParentToolCallId(baseToolCall, input.parentToolCallId);
        }
        return withParentToolCallId(
          {
            type: "webSearch",
            id: input.callId,
            queries: normalized,
            resultText: null,
          },
          input.parentToolCallId,
        );
      }

      const parsed = claudeWebFetchArgsSchema.safeParse(input.args);
      if (!parsed.success) {
        return withParentToolCallId(baseToolCall, input.parentToolCallId);
      }
      const normalized = normalizeClaudeWebFetchArgs(parsed.data);
      if (!normalized) {
        return withParentToolCallId(baseToolCall, input.parentToolCallId);
      }
      return withParentToolCallId(
        {
          type: "webFetch",
          id: input.callId,
          url: normalized.url,
          prompt: normalized.prompt,
          pattern: null,
          resultText: null,
        },
        input.parentToolCallId,
      );
    }
    default:
      return withParentToolCallId(baseToolCall, input.parentToolCallId);
  }
}

function parseClaudeTaskToolOutputValue(
  value: unknown,
): ClaudeTaskToolOutput | null {
  const parsed = claudeTaskToolOutputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (typeof value !== "string") return null;
  try {
    const json: unknown = JSON.parse(value);
    const parsedJson = claudeTaskToolOutputSchema.safeParse(json);
    return parsedJson.success ? parsedJson.data : null;
  } catch {
    return null;
  }
}

function parseClaudeTaskToolOutput(
  args: ParseClaudeTaskToolOutputArgs,
): ClaudeTaskToolOutput | null {
  return (
    parseClaudeTaskToolOutputValue(args.content) ??
    parseClaudeTaskToolOutputValue(args.toolUseResult) ??
    parseClaudeTaskToolOutputValue(args.outputText)
  );
}

function translateClaudeToolResultItem(
  input: ClaudeToolResultTranslationInput,
): ThreadEventItem {
  const outputText =
    input.toolName === "Bash" || input.startedItem?.type === "commandExecution"
      ? extractClaudeCommandExecutionOutput({
          content: input.content,
          toolUseResult: input.toolUseResult,
        })
      : extractResultText(input.content);
  const startedItem = input.startedItem;
  const itemStatus = input.isError ? "failed" : "completed";
  const bashExitCode = input.isError ? 1 : 0;

  if (startedItem) {
    switch (startedItem.type) {
      case "commandExecution":
        return withParentToolCallId(
          {
            type: "commandExecution",
            id: input.callId,
            command: startedItem.command,
            cwd: startedItem.cwd,
            ...(outputText === undefined
              ? {}
              : { aggregatedOutput: outputText }),
            exitCode: bashExitCode,
            status: itemStatus,
            approvalStatus: startedItem.approvalStatus,
          },
          input.parentToolCallId ?? startedItem.parentToolCallId,
        );
      case "fileChange":
        return withParentToolCallId(
          {
            type: "fileChange",
            id: input.callId,
            changes: startedItem.changes,
            status: itemStatus,
            approvalStatus: startedItem.approvalStatus,
          },
          input.parentToolCallId ?? startedItem.parentToolCallId,
        );
      case "webSearch":
        return withParentToolCallId(
          {
            type: "webSearch",
            id: input.callId,
            queries: startedItem.queries,
            resultText: outputText ?? null,
          },
          input.parentToolCallId ?? startedItem.parentToolCallId,
        );
      case "webFetch":
        return withParentToolCallId(
          {
            type: "webFetch",
            id: input.callId,
            url: startedItem.url,
            prompt: startedItem.prompt,
            pattern: startedItem.pattern,
            resultText: outputText ?? null,
          },
          input.parentToolCallId ?? startedItem.parentToolCallId,
        );
      case "toolCall": {
        const taskToolResult = claudeTaskToolNameSchema.safeParse(
          startedItem.tool,
        ).success
          ? parseClaudeTaskToolOutput({
              content: input.content,
              outputText,
              toolUseResult: input.toolUseResult,
            })
          : null;
        return withParentToolCallId(
          {
            type: "toolCall",
            id: input.callId,
            tool: startedItem.tool,
            arguments: startedItem.arguments,
            status: itemStatus,
            result: taskToolResult ?? outputText,
          },
          input.parentToolCallId ?? startedItem.parentToolCallId,
        );
      }
      default:
        break;
    }
  }

  const fallbackTaskToolResult =
    input.toolName && claudeTaskToolNameSchema.safeParse(input.toolName).success
      ? parseClaudeTaskToolOutput({
          content: input.content,
          outputText,
          toolUseResult: input.toolUseResult,
        })
      : null;
  const fallbackToolCall = withParentToolCallId(
    {
      type: "toolCall",
      id: input.callId,
      tool: input.toolName ?? "unknown",
      status: itemStatus,
      result: fallbackTaskToolResult ?? outputText,
    },
    input.parentToolCallId,
  );

  switch (input.toolName) {
    case "Bash":
      return withParentToolCallId(
        {
          type: "commandExecution",
          id: input.callId,
          command: "",
          cwd: "",
          ...(outputText === undefined ? {} : { aggregatedOutput: outputText }),
          exitCode: bashExitCode,
          status: itemStatus,
          approvalStatus: null,
        },
        input.parentToolCallId,
      );
    case "Edit":
    case "Write":
      return withParentToolCallId(
        {
          type: "fileChange",
          id: input.callId,
          changes: [],
          status: itemStatus,
          approvalStatus: null,
        },
        input.parentToolCallId,
      );
    case "WebSearch":
    case "WebFetch":
      return fallbackToolCall;
    default:
      return fallbackToolCall;
  }
}

// ---------------------------------------------------------------------------
// Claude Code–specific helpers
// ---------------------------------------------------------------------------

function buildClaudeCodeConfig(
  envVars?: Record<string, string>,
): Record<string, unknown> | undefined {
  const config = buildShellEnvironmentPolicyConfig(envVars);
  return config ? { ...config } : undefined;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export interface CreateClaudeCodeProviderAdapterOptions extends ProviderAdapterFactoryOptions {
  /** Override the directory containing bundled bridge files. */
  bridgeBundleDir?: string;
  /** Prefix for bb-owned turn ids emitted by this adapter instance. */
  turnIdPrefix?: string;
}

interface TranslateClaudeErrorEnvelopeArgs {
  context?: ProviderTranslationContext;
  detail: string;
}

interface ParseClaudeTaskToolOutputArgs {
  content: unknown;
  outputText: string | undefined;
  toolUseResult: ClaudeToolUseResult | null;
}

interface ResolveClaudeInteractiveRequestTurnIdArgs {
  threadId: string;
  turnId: string | null;
}

export function createClaudeCodeProviderAdapter(
  opts?: CreateClaudeCodeProviderAdapterOptions,
): ProviderAdapter {
  const additionalWorkspaceWriteRoots =
    opts?.additionalWorkspaceWriteRoots ?? [];
  const providerInfo = getBuiltInAgentProviderInfo("claude-code");
  const capabilities = providerInfo.capabilities;

  const turnState = createProviderTurnStateRegistry<ClaudeTurnState>({
    createState: () => ({
      assistantMessageCounter: 0,
      counter: 0,
      currentTurnId: undefined,
      cumulativeTokens: {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      latestRequestContextTokens: undefined,
      openAssistantMessageIdsByScope: new Map(),
      openCompaction: undefined,
      openReasoningItemIdsByScope: new Map(),
      pendingAcceptedUserMessages: [],
      reasoningItemCounter: 0,
      selectedModelContextWindow: null,
      tasksById: new Map(),
      toolItemsByCallId: new Map(),
    }),
    // An idle thread with a running workflow must keep its task state — LRU
    // eviction would orphan the open backgroundTask items.
    isEvictable: (state) => !hasOpenClaudeBackgroundTasks(state.tasksById),
    turnIdPrefix: opts?.turnIdPrefix,
  });

  function setClaudeModelContextWindowHint(
    threadId: string,
    model: string,
  ): void {
    const state = turnState.getOrCreate({ threadId });
    state.selectedModelContextWindow =
      resolveClaudeModelContextWindowHint(model);
  }

  function ensureClaudeTurnStarted(
    args: EnsureProviderTurnStartedArgs<ClaudeTurnState>,
  ): string {
    const hadOpenTurn = args.state.currentTurnId !== undefined;
    if (!hadOpenTurn) {
      args.state.latestRequestContextTokens = undefined;
    }
    const turnId = turnState.ensureTurnStarted(args);
    if (!hadOpenTurn) {
      drainAcceptedUserMessages({
        events: args.events,
        providerThreadId: "",
        state: args.state,
        threadId: args.threadId,
        turnId,
      });
    }
    return turnId;
  }

  function translateClaudeErrorEnvelope(
    args: TranslateClaudeErrorEnvelopeArgs,
  ): ThreadEvent[] {
    return buildScopedProviderErrorEvents({
      contextThreadId: args.context?.threadId,
      detail: args.detail,
      ensureTurnStarted: ensureClaudeTurnStarted,
      registry: turnState,
    });
  }

  function resolveClaudeInteractiveRequestTurnId(
    args: ResolveClaudeInteractiveRequestTurnIdArgs,
  ): string | null {
    if (args.turnId !== null) {
      return args.turnId;
    }

    const state = turnState.get({ threadId: args.threadId });
    if (state === null) {
      return null;
    }
    const currentTurnId = turnState.getCurrentOrLastTurnId({ state });
    return currentTurnId.length > 0 ? currentTurnId : null;
  }

  function resolveClaudeActiveTurnId(
    context?: ProviderTranslationContext,
  ): string | undefined {
    if (!context?.threadId) {
      return undefined;
    }
    return turnState.get({ threadId: context.threadId })?.currentTurnId;
  }

  function translateClaudeEvent(
    event: unknown,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      const sdkMessage = sdkEnvelope.data.params.message;
      const nestedParentToolCallId = getNestedParentToolUseId(sdkMessage);
      const parentToolCallId = nestedParentToolCallId
        ? nestedParentToolCallId
        : (sdkEnvelope.data.params.parent_tool_use_id ??
          context?.parentToolCallId);
      const translated = translateClaudeEvent(sdkMessage, {
        ...context,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      const fallbackTurnId = resolveClaudeActiveTurnId(context);
      return translated.length > 0
        ? translated
        : buildUnhandledProviderEvents({
            providerId: "claude-code",
            rawEvent: {
              jsonrpc: "2.0",
              method: sdkEnvelope.data.method,
              params: sdkEnvelope.data.params,
            },
            visibilityMetadata: claudeCodeVisibilityMetadata,
            ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
            ...(parentToolCallId ? { parentToolCallId } : {}),
          });
    }

    const identityEnvelope = threadIdentityEnvelopeSchema.safeParse(event);
    if (identityEnvelope.success) {
      const { threadId = UNSTAMPED_THREAD_ID, providerThreadId } =
        identityEnvelope.data.params;
      return providerThreadId
        ? [
            {
              type: "thread/identity",
              threadId,
              providerThreadId,
              scope: threadScope(),
            },
          ]
        : [];
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      return translateClaudeErrorEnvelope({
        context,
        detail: errorEnvelope.data.params?.message ?? "unknown error",
      });
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (envelope.success) {
      const fallbackTurnId = resolveClaudeActiveTurnId(context);
      return buildUnhandledProviderEvents({
        providerId: "claude-code",
        rawEvent: {
          jsonrpc: "2.0",
          method: envelope.data.method,
          ...(envelope.data.params ? { params: envelope.data.params } : {}),
        },
        visibilityMetadata: claudeCodeVisibilityMetadata,
        ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
        ...(context?.parentToolCallId
          ? { parentToolCallId: context.parentToolCallId }
          : {}),
      });
    }

    return translateClaudeSdkMessage({
      buildUnexpectedSdkEvent: buildUnexpectedClaudeSdkEvent,
      context,
      ensureTurnStarted: ensureClaudeTurnStarted,
      event,
      translateToolResultItem: translateClaudeToolResultItem,
      translateToolUseItem: translateClaudeToolUseItem,
      turnState,
    });
  }

  return {
    // -- Identity & launch -------------------------------------------------

    id: providerInfo.id,
    displayName: providerInfo.displayName,
    capabilities,
    process: {
      command: "node",
      args: resolveBridgeProcessArgs({
        bridgeBundleDir: opts?.bridgeBundleDir,
        bundleFileName: "bb-claude-code-bridge.mjs",
        importMetaUrl: import.meta.url,
        bridgeRelativePath: "bridge/bridge.js",
      }),
    },

    // -- Unified command builder -------------------------------------------

    buildCommandPlan(command: AdapterCommand): ProviderCommandPlan {
      switch (command.type) {
        case "initialize":
          return {
            kind: "request",
            method: "initialize",
            params: { clientInfo: { name: "bb", version: "1.0.0" } },
          };
        case "model/list":
          return {
            kind: "request",
            method: "model/list",
            params: {},
          };
        case "skills/configure":
          return {
            kind: "noop",
            reason: "Claude Code skill roots are configured per session",
          };
        case "thread/start": {
          finishOpenProviderTurn({
            registry: turnState,
            threadId: command.threadId,
          });
          const baseInstructions = command.options?.instructions ?? "";
          if (command.options?.model) {
            setClaudeModelContextWindowHint(
              command.threadId,
              command.options.model,
            );
          }
          const config = buildClaudeCodeConfig(command.options?.envVars);
          const dynamicTools = command.dynamicTools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: jsonValueSchema.parse(t.inputSchema),
          }));
          const permissionPolicy = resolveAdapterPermissionPolicy(
            command.options,
          );
          const additionalWorkspaceWriteRootsParams =
            permissionPolicy.permissionMode === "workspace-write"
              ? buildAdditionalWorkspaceWriteRootsParams(
                  additionalWorkspaceWriteRoots,
                )
              : undefined;
          const skillConfig = buildClaudeSkillConfigParams(
            command.options.skillRoots,
          );
          return {
            kind: "request",
            method: "thread/start",
            params: {
              baseInstructions,
              threadId: command.threadId,
              cwd: command.cwd,
              instructionMode: command.instructionMode,
              claudeCodeMockCliTraffic:
                command.options.claudeCodeMockCliTraffic,
              permissionMode: toClaudePermissionMode(permissionPolicy),
              permissionEscalation: permissionPolicy.permissionEscalation,
              ...(additionalWorkspaceWriteRootsParams
                ? additionalWorkspaceWriteRootsParams
                : {}),
              ...(skillConfig ? skillConfig : {}),
              ...(config ? { config } : {}),
              ...(command.options?.model
                ? { model: command.options.model }
                : {}),
              ...(command.options?.reasoningLevel
                ? { reasoningLevel: command.options.reasoningLevel }
                : {}),
              workflowsEnabled: command.options.workflowsEnabled,
              ...(dynamicTools && dynamicTools.length > 0
                ? { dynamicTools }
                : {}),
              ...(command.disallowedTools && command.disallowedTools.length > 0
                ? { disallowedTools: [...command.disallowedTools] }
                : {}),
            },
          };
        }
        case "thread/resume": {
          finishOpenProviderTurn({
            registry: turnState,
            threadId: command.threadId,
          });
          const baseInstructions = command.options?.instructions ?? "";
          if (command.options?.model) {
            setClaudeModelContextWindowHint(
              command.threadId,
              command.options.model,
            );
          }
          const resumeConfig = buildClaudeCodeConfig(command.options?.envVars);
          const dynamicTools = command.dynamicTools?.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: jsonValueSchema.parse(t.inputSchema),
          }));
          const permissionPolicy = resolveAdapterPermissionPolicy(
            command.options,
          );
          const additionalWorkspaceWriteRootsParams =
            permissionPolicy.permissionMode === "workspace-write"
              ? buildAdditionalWorkspaceWriteRootsParams(
                  additionalWorkspaceWriteRoots,
                )
              : undefined;
          const skillConfig = buildClaudeSkillConfigParams(
            command.options.skillRoots,
          );
          return {
            kind: "request",
            method: "thread/resume",
            params: {
              baseInstructions,
              threadId: command.threadId,
              cwd: command.cwd,
              providerThreadId: command.providerThreadId,
              instructionMode: command.instructionMode,
              claudeCodeMockCliTraffic:
                command.options.claudeCodeMockCliTraffic,
              permissionMode: toClaudePermissionMode(permissionPolicy),
              permissionEscalation: permissionPolicy.permissionEscalation,
              ...(additionalWorkspaceWriteRootsParams
                ? additionalWorkspaceWriteRootsParams
                : {}),
              ...(skillConfig ? skillConfig : {}),
              ...(resumeConfig ? { config: resumeConfig } : {}),
              ...(command.options?.model
                ? { model: command.options.model }
                : {}),
              ...(command.options?.reasoningLevel
                ? { reasoningLevel: command.options.reasoningLevel }
                : {}),
              workflowsEnabled: command.options.workflowsEnabled,
              ...(dynamicTools && dynamicTools.length > 0
                ? { dynamicTools }
                : {}),
              ...(command.disallowedTools && command.disallowedTools.length > 0
                ? { disallowedTools: [...command.disallowedTools] }
                : {}),
            },
          };
        }
        case "turn/start":
          if (command.options?.model) {
            setClaudeModelContextWindowHint(
              command.threadId,
              command.options.model,
            );
          }
          return {
            kind: "request",
            method: "turn/start",
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              input: command.input,
              ...(command.options?.model
                ? { model: command.options.model }
                : {}),
            },
          };
        case "turn/steer":
          return {
            kind: "request",
            method: "turn/steer",
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              expectedTurnId: command.expectedTurnId,
              input: command.input,
            },
          };
        case "thread/stop":
          finishOpenProviderTurn({
            registry: turnState,
            threadId: command.threadId,
          });
          return {
            kind: "request",
            method: "thread/stop",
            params: {
              threadId: command.threadId,
            },
          };
        case "thread/name/set":
          return { kind: "noop", reason: "rename unsupported" };
        case "thread/archive":
        case "thread/unarchive":
          return { kind: "noop", reason: "archive unsupported" };
      }
    },

    // -- Unified event translator ------------------------------------------

    translateEvent(
      event: ProviderRuntimeEvent,
      context?: ProviderTranslationContext,
    ): ThreadEvent[] {
      return translateClaudeEvent(event, context);
    },

    prepareTurnStart: noPreparedProviderCommandDispatch,

    translateAcceptedCommand({ command }) {
      if (
        command.type === "thread/start" ||
        command.type === "thread/resume" ||
        command.type === "thread/stop"
      ) {
        const state = turnState.getOrCreate({ threadId: command.threadId });
        state.pendingAcceptedUserMessages = [];
        // Starting, resuming, or stopping a thread replaces/kills the CLI
        // session, and background tasks die with it — settle them as
        // interrupted so no workflow row dangles as running.
        return buildInterruptedClaudeTaskEvents({
          tasks: state.tasksById,
          threadId: command.threadId,
        });
      }

      if (command.type === "turn/start") {
        const state = turnState.getOrCreate({ threadId: command.threadId });
        if (state.currentTurnId !== undefined) {
          return buildAcceptedUserMessageEvent({
            clientRequestId: command.clientRequestId,
            providerThreadId: command.providerThreadId,
            threadId: command.threadId,
            turnId: state.currentTurnId,
          });
        }
        queueAcceptedUserMessage({
          clientRequestId: command.clientRequestId,
          state,
        });
      }

      if (command.type === "turn/steer") {
        return buildAcceptedUserMessageEvent({
          clientRequestId: command.clientRequestId,
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
          turnId: command.expectedTurnId,
        });
      }

      return [];
    },

    buildThreadDetachedEvents({ threadId }) {
      const state = turnState.get({ threadId });
      if (!state) {
        return [];
      }
      return buildInterruptedClaudeTaskEvents({
        tasks: state.tasksById,
        threadId,
      });
    },

    parseModelListResult(result: unknown) {
      return parseAvailableModelList(result);
    },

    // -- Tool call codec ---------------------------------------------------

    decodeToolCallRequest(
      request: ProviderInboundRequest,
    ): DecodedToolCallRequest | null {
      if (typeof request.id !== "string" && typeof request.id !== "number") {
        return null;
      }
      return decodeNormalizedProviderToolCallRequest(
        request.id,
        request.method,
        request.params,
      );
    },

    decodeInteractiveRequest(
      request: ProviderInboundRequest,
    ): DecodedInteractiveRequest | null {
      if (typeof request.id !== "string" && typeof request.id !== "number") {
        return null;
      }

      switch (request.method) {
        case CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD: {
          const parsed = claudePermissionRequestApprovalParamsSchema.safeParse(
            request.params,
          );
          if (!parsed.success) {
            return null;
          }
          const turnId = resolveClaudeInteractiveRequestTurnId({
            threadId: parsed.data.threadId,
            turnId: parsed.data.turnId,
          });
          if (turnId === null) {
            return null;
          }
          return {
            requestId: request.id,
            method: request.method,
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            turnId,
            payload: {
              kind: "approval",
              subject: buildClaudeApprovalSubject(parsed.data),
              reason: parsed.data.reason,
              availableDecisions: buildClaudeApprovalAvailableDecisions(
                parsed.data,
              ),
            },
          };
        }
        case CLAUDE_USER_QUESTION_REQUEST_METHOD: {
          const parsed = claudeUserQuestionRequestParamsSchema.safeParse(
            request.params,
          );
          if (!parsed.success) {
            return null;
          }
          const turnId = resolveClaudeInteractiveRequestTurnId({
            threadId: parsed.data.threadId,
            turnId: parsed.data.turnId,
          });
          if (turnId === null) {
            return null;
          }
          return {
            requestId: request.id,
            method: request.method,
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            turnId,
            payload: buildClaudeUserQuestionPayload(parsed.data),
          };
        }
        default:
          return null;
      }
    },

    buildInteractiveResponse(args) {
      if (
        isUserQuestionPendingInteractionPayload(args.request.payload) &&
        isUserQuestionPendingInteractionResolution(args.resolution)
      ) {
        return {
          kind: "user_question",
          behavior: "allow",
          updatedInput: buildClaudeUserQuestionOutput(
            args.request.payload,
            args.resolution,
          ),
        };
      }

      if (
        !isApprovalPendingInteractionPayload(args.request.payload) ||
        !isApprovalPendingInteractionResolution(args.resolution)
      ) {
        throw new ProviderResponseEncodeError(
          "Claude Code interactive response kind does not match the request payload",
        );
      }

      if (args.resolution.decision === "deny") {
        return {
          kind: "permission_request",
          behavior: "deny",
          message: "Permission request denied",
          decisionClassification: "user_reject",
        };
      }

      if (args.resolution.decision === "allow_once") {
        // Claude canUseTool approvals without updatedPermissions apply only
        // to the current tool request. Session grants are the only scope
        // that should mutate Claude's permission state.
        return {
          kind: "permission_request",
          behavior: "allow",
          decisionClassification: "user_temporary",
        };
      }

      const updatedPermissions = buildClaudeSessionPermissionUpdates({
        permissions: resolveClaudeGrantedPermissions(
          args.resolution.grantedPermissions,
        ),
        toolName: getClaudePermissionUpdateToolName(args.request.payload),
      });

      return {
        kind: "permission_request",
        behavior: "allow",
        decisionClassification: "user_permanent",
        ...(updatedPermissions === undefined ? {} : { updatedPermissions }),
      };
    },
  };
}

function buildUnexpectedClaudeSdkEvent(
  args: ClaudeUnexpectedSdkEventArgs,
): ThreadEvent[] {
  const rawEvent: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: "sdk/message",
    params: {
      ...(args.context?.threadId ? { threadId: args.context.threadId } : {}),
      message: args.event,
    },
  };
  return [
    createUnhandledProviderEvent({
      providerId: "claude-code",
      rawEvent,
      rawType: claudeCodeVisibilityMetadata.describeRawEvent(rawEvent).kind,
      ...(args.turnId ? { turnId: args.turnId } : {}),
      ...(args.context?.parentToolCallId
        ? { parentToolCallId: args.context.parentToolCallId }
        : {}),
    }),
  ];
}
