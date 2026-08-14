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
  PromptInput,
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
  removeCommandMentionsFromPromptInput,
  threadScope,
} from "@bb/domain";
import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isUserQuestionPendingInteractionPayload,
  isUserQuestionPendingInteractionResolution,
} from "@bb/domain";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import { createStandardAdapterMembers } from "../shared/standard-adapter-members.js";
import { bashArgsSchema } from "../shared/tool-arg-schemas.js";
import {
  buildShellEnvironmentPolicyConfig,
  extractResultText,
  toOptionalString,
} from "../shared/adapter-utils.js";
import {
  buildToolResultItem,
  buildToolUseItem,
  type ToolUseTranslationInput,
} from "../shared/tool-item-translation.js";
import { drainAcceptedUserMessages } from "../shared/accepted-user-messages.js";
import {
  createProviderTurnStateRegistry,
  finishOpenProviderTurn,
} from "../shared/turn-state.js";
import {
  buildUnhandledProviderEvents,
  createUnhandledProviderEvent,
} from "../shared/provider-unhandled-event.js";
import { UNSTAMPED_THREAD_ID } from "../shared/unstamped-thread-id.js";
import {
  errorEnvelopeSchema,
  jsonRpcEnvelopeSchema,
  sdkMessageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
} from "../shared/json-rpc-envelope.js";
import type {
  DecodedInteractiveRequest,
  ProviderExecutionContext,
  ProviderTranslationContext,
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "../provider-adapter.js";
import {
  classifyClaudeExecutionSettingsChange,
  normalizeClaudeExecutionOptions,
} from "../execution-options.js";
import {
  type JsonRpcMessage,
  type ProviderInboundRequest,
  ProviderResponseEncodeError,
} from "../runtime-json-rpc.js";
import type { AgentRuntimeSkillRoot } from "../types.js";
import {
  buildClaudePlanRejectionMessage,
  buildClaudeSessionPermissionUpdates,
  CLAUDE_EXIT_PLAN_MODE_TOOL_NAME,
  CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD,
  CLAUDE_USER_QUESTION_REQUEST_METHOD,
  claudeExitPlanModeInputSchema,
  isClaudeConcreteFileChangeToolName,
  type ClaudeUserQuestion,
  type ClaudeUserQuestionOutput,
  type ClaudeUserQuestionRequestParams,
  type ClaudePermissionRequestApprovalParams,
  type ClaudePermissionMode,
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
  // A plan verdict is not a grant, so "allow for session" has nothing to mean.
  if (args.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME) {
    return ["allow_once", "deny"];
  }
  return hasClaudeSessionPermissionUpdate(args)
    ? ["allow_once", "allow_for_session", "deny"]
    : ["allow_once", "deny"];
}

function buildClaudeApprovalSubject(
  args: ClaudePermissionRequestApprovalParams,
): PendingInteractionApprovalSubject {
  if (args.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME) {
    const parsed = claudeExitPlanModeInputSchema.safeParse(args.input);
    if (parsed.success) {
      return {
        kind: "plan",
        itemId: args.itemId,
        plan: parsed.data.plan,
        planFilePath: parsed.data.planFilePath ?? null,
      };
    }
  }

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
    // A plan verdict grants nothing, so it never reaches a session update.
    case "plan":
      return null;
  }
}

function translateClaudeToolUseItem(
  input: ClaudeToolUseTranslationInput,
): ThreadEventItem {
  return buildToolUseItem(input, {
    commandToolNames: CLAUDE_COMMAND_TOOL_NAMES,
    fileChangeToolNames: CLAUDE_FILE_CHANGE_TOOL_NAMES,
    parseCommand(args) {
      const command = parseClaudeBashCommand(args);
      return command
        ? { command: command.command, cwd: command.cwd ?? "" }
        : null;
    },
    parseFileChange(args) {
      const parsed = claudeFileEditArgsSchema.safeParse(args);
      return parsed.success
        ? {
            arguments: parsed.data,
            path: getClaudeFileEditPath(parsed.data) ?? undefined,
            oldText: parsed.data.old_string,
            newText: parsed.data.new_string ?? parsed.data.content,
          }
        : null;
    },
    translateSpecialToolUse: translateClaudeWebToolUse,
  });
}

const CLAUDE_COMMAND_TOOL_NAMES = new Set(["Bash"]);
const CLAUDE_FILE_CHANGE_TOOL_NAMES = new Set(["Edit", "Write"]);

function translateClaudeWebToolUse(
  input: ToolUseTranslationInput,
): ThreadEventItem | null {
  if (input.toolName === "WebSearch") {
    const parsed = claudeWebSearchArgsSchema.safeParse(input.args);
    const queries = parsed.success
      ? normalizeClaudeWebSearchArgs(parsed.data)
      : null;
    return queries
      ? {
          type: "webSearch",
          id: input.callId,
          queries,
          resultText: null,
        }
      : null;
  }
  if (input.toolName !== "WebFetch") {
    return null;
  }
  const parsed = claudeWebFetchArgsSchema.safeParse(input.args);
  const normalized = parsed.success
    ? normalizeClaudeWebFetchArgs(parsed.data)
    : null;
  return normalized
    ? {
        type: "webFetch",
        id: input.callId,
        url: normalized.url,
        prompt: normalized.prompt,
        pattern: null,
        resultText: null,
      }
    : null;
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
  const resultToolName =
    input.startedItem?.type === "toolCall"
      ? input.startedItem.tool
      : input.toolName;
  const taskToolResult =
    resultToolName && claudeTaskToolNameSchema.safeParse(resultToolName).success
      ? parseClaudeTaskToolOutput({
          content: input.content,
          outputText,
          toolUseResult: input.toolUseResult,
        })
      : null;
  return buildToolResultItem({
    ...input,
    commandOutputText: outputText,
    commandToolNames: CLAUDE_COMMAND_TOOL_NAMES,
    completeWebItems: true,
    fileChangeToolNames: CLAUDE_FILE_CHANGE_TOOL_NAMES,
    outputText,
    toolCallResult: taskToolResult ?? outputText,
  });
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

function resolveClaudeSessionPermissionMode(
  options: ProviderExecutionContext,
): ClaudePermissionMode {
  return options.claudeCodePermissionMode ?? toClaudePermissionMode(options);
}

function stripClaudePlanCommandInput(
  input: readonly PromptInput[],
  options: ProviderExecutionContext,
): PromptInput[] {
  if (options.claudeCodePermissionMode !== "plan") {
    return [...input];
  }
  return removeCommandMentionsFromPromptInput(input, {
    trigger: "/",
    name: "plan",
  });
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
      latestProviderCheckpointId: undefined,
      lastModelFallback: undefined,
      openAssistantMessageIdsByScope: new Map(),
      openCompaction: undefined,
      openReasoningItemIdsByScope: new Map(),
      opaqueTaskIds: new Set(),
      pendingAcceptedUserMessages: [],
      pendingHardRateLimitRejection: undefined,
      reasoningItemCounter: 0,
      selectedModelContextWindow: null,
      tasksById: new Map(),
      toolItemsByCallId: new Map(),
    }),
    // An idle thread with a running workflow must keep its task state — LRU
    // eviction would orphan the open backgroundTask items.
    isEvictable: (state) =>
      !hasOpenClaudeBackgroundTasks(state.tasksById) &&
      state.opaqueTaskIds.size === 0,
    onTurnStart: ({ events, state, threadId, turnId }) => {
      state.latestRequestContextTokens = undefined;
      state.latestProviderCheckpointId = undefined;
      state.pendingHardRateLimitRejection = undefined;
      drainAcceptedUserMessages({
        events,
        providerThreadId: "",
        state,
        threadId,
        turnId,
      });
    },
    onTurnFinish: ({ state }) => {
      state.pendingHardRateLimitRejection = undefined;
    },
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
      return turnState.buildErrorEvents({
        contextThreadId: context?.threadId,
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
      ensureTurnStarted: turnState.ensureTurnStarted,
      event,
      translateToolResultItem: translateClaudeToolResultItem,
      translateToolUseItem: translateClaudeToolUseItem,
      turnState,
    });
  }

  return {
    ...createStandardAdapterMembers({
      id: providerInfo.id,
      displayName: providerInfo.displayName,
      capabilities,
      approvalRequestPolicy: "provider",
      classifyExecutionSettingsChange: classifyClaudeExecutionSettingsChange,
      normalizeExecutionOptions: normalizeClaudeExecutionOptions,
      process: {
        command: opts?.bridgeNodeExecutablePath ?? "node",
        args: resolveBridgeProcessArgs({
          bridgeBundleDir: opts?.bridgeBundleDir,
          bundleFileName: "bb-claude-code-bridge.mjs",
          importMetaUrl: import.meta.url,
          bridgeRelativePath: "bridge/bridge.js",
        }),
        ...(opts?.bridgeNodeEnv !== undefined
          ? { env: opts.bridgeNodeEnv }
          : {}),
      },
      initializeParams: { clientInfo: { name: "bb", version: "1.0.0" } },
      codec: "normalized",
      turnState,
      translateEvent: translateClaudeEvent,
      onSessionReplace: ({ command, state }) => {
        // Replacing the CLI session kills background tasks with it.
        const events = buildInterruptedClaudeTaskEvents({
          tasks: state.tasksById,
          threadId: command.threadId,
        });
        state.opaqueTaskIds.clear();
        return events;
      },
      buildProviderCommandPlan(command) {
        switch (command.type) {
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
            const permissionPolicy = command.options;
            const additionalWorkspaceWriteRootsParams =
              permissionPolicy.permissionScope === "workspace"
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
                permissionMode: resolveClaudeSessionPermissionMode(
                  command.options,
                ),
                approvedPlanPermissionMode:
                  toClaudePermissionMode(permissionPolicy),
                permissionScope: permissionPolicy.permissionScope,
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
                memoryEnabled: command.options.memoryEnabled,
                providerSubagentsEnabled:
                  command.options.providerSubagentsEnabled,
                ...(dynamicTools && dynamicTools.length > 0
                  ? { dynamicTools }
                  : {}),
                ...(command.disallowedTools &&
                command.disallowedTools.length > 0
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
            const resumeConfig = buildClaudeCodeConfig(
              command.options?.envVars,
            );
            const dynamicTools = command.dynamicTools?.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: jsonValueSchema.parse(t.inputSchema),
            }));
            const permissionPolicy = command.options;
            const additionalWorkspaceWriteRootsParams =
              permissionPolicy.permissionScope === "workspace"
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
                permissionMode: resolveClaudeSessionPermissionMode(
                  command.options,
                ),
                approvedPlanPermissionMode:
                  toClaudePermissionMode(permissionPolicy),
                permissionScope: permissionPolicy.permissionScope,
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
                memoryEnabled: command.options.memoryEnabled,
                providerSubagentsEnabled:
                  command.options.providerSubagentsEnabled,
                ...(dynamicTools && dynamicTools.length > 0
                  ? { dynamicTools }
                  : {}),
                ...(command.disallowedTools &&
                command.disallowedTools.length > 0
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
                input: stripClaudePlanCommandInput(
                  command.input,
                  command.options,
                ),
                ...(command.inputGroups !== undefined
                  ? {
                      inputGroups: command.inputGroups.map((inputGroup) =>
                        stripClaudePlanCommandInput(
                          inputGroup,
                          command.options,
                        ),
                      ),
                    }
                  : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? { reasoningLevel: command.options.reasoningLevel }
                  : {}),
                workflowsEnabled: command.options.workflowsEnabled,
                memoryEnabled: command.options.memoryEnabled,
                providerSubagentsEnabled:
                  command.options.providerSubagentsEnabled,
                permissionEscalation: command.options.permissionEscalation,
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
                input: stripClaudePlanCommandInput(
                  command.input,
                  command.options,
                ),
                ...(command.inputGroups !== undefined
                  ? {
                      inputGroups: command.inputGroups.map((inputGroup) =>
                        stripClaudePlanCommandInput(
                          inputGroup,
                          command.options,
                        ),
                      ),
                    }
                  : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? { reasoningLevel: command.options.reasoningLevel }
                  : {}),
                workflowsEnabled: command.options.workflowsEnabled,
                memoryEnabled: command.options.memoryEnabled,
                providerSubagentsEnabled:
                  command.options.providerSubagentsEnabled,
                permissionEscalation: command.options.permissionEscalation,
              },
            };
          case "thread/fork": {
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
            const forkConfig = buildClaudeCodeConfig(command.options?.envVars);
            const dynamicTools = command.dynamicTools?.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: jsonValueSchema.parse(t.inputSchema),
            }));
            const permissionPolicy = command.options;
            const additionalWorkspaceWriteRootsParams =
              permissionPolicy.permissionScope === "workspace"
                ? buildAdditionalWorkspaceWriteRootsParams(
                    additionalWorkspaceWriteRoots,
                  )
                : undefined;
            const skillConfig = buildClaudeSkillConfigParams(
              command.options.skillRoots,
            );
            return {
              kind: "request",
              method: "thread/fork",
              params: {
                baseInstructions,
                threadId: command.threadId,
                cwd: command.cwd,
                sourceProviderThreadId: command.sourceProviderThreadId,
                ...(command.sourceProviderCheckpointId !== undefined
                  ? {
                      sourceProviderCheckpointId:
                        command.sourceProviderCheckpointId,
                    }
                  : {}),
                instructionMode: command.instructionMode,
                claudeCodeMockCliTraffic:
                  command.options.claudeCodeMockCliTraffic,
                permissionMode: resolveClaudeSessionPermissionMode(
                  command.options,
                ),
                approvedPlanPermissionMode:
                  toClaudePermissionMode(permissionPolicy),
                permissionScope: permissionPolicy.permissionScope,
                permissionEscalation: permissionPolicy.permissionEscalation,
                ...(additionalWorkspaceWriteRootsParams
                  ? additionalWorkspaceWriteRootsParams
                  : {}),
                ...(skillConfig ? skillConfig : {}),
                ...(forkConfig ? { config: forkConfig } : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? { reasoningLevel: command.options.reasoningLevel }
                  : {}),
                workflowsEnabled: command.options.workflowsEnabled,
                memoryEnabled: command.options.memoryEnabled,
                providerSubagentsEnabled:
                  command.options.providerSubagentsEnabled,
                ...(dynamicTools && dynamicTools.length > 0
                  ? { dynamicTools }
                  : {}),
                ...(command.disallowedTools &&
                command.disallowedTools.length > 0
                  ? { disallowedTools: [...command.disallowedTools] }
                  : {}),
              },
            };
          }
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
          case "thread/discard":
            return {
              kind: "request",
              method: "thread/stop",
              params: { threadId: command.threadId },
            };
          default:
            return null;
        }
      },
    }),

    buildThreadDetachedEvents({ threadId }) {
      const state = turnState.get({ threadId });
      if (!state) {
        return [];
      }
      const events = buildInterruptedClaudeTaskEvents({
        tasks: state.tasksById,
        threadId,
      });
      state.opaqueTaskIds.clear();
      return events;
    },

    hasOpenThreadWork({ threadId }) {
      const state = turnState.get({ threadId });
      return (
        state !== null &&
        (hasOpenClaudeBackgroundTasks(state.tasksById) ||
          state.opaqueTaskIds.size > 0)
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
          message:
            args.request.payload.subject.kind === "plan"
              ? buildClaudePlanRejectionMessage()
              : "Permission request denied",
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
