/**
 * Codex provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the OpenAI Codex app-server
 * JSON-RPC protocol. Validates the outer JSON-RPC envelope before translating
 * the provider-specific payloads.
 *
 * Reference: https://github.com/openai/codex (codex-rs/app-server-protocol/)
 */

import fs from "node:fs";
import path from "node:path";
import { getBuiltInAgentProviderInfo } from "@bb/agent-providers";
import {
  getThreadEventScopeTurnId,
  isStandaloneBuiltinCompactCommand,
  jsonValueSchema,
  requireThreadEventScopeTurnId,
  turnScope,
} from "@bb/domain";
import type {
  ClientTurnRequestId,
  PermissionEscalation,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
  ThreadEvent,
} from "@bb/domain";
import type { ReasoningEffort as CodexReasoningEffort } from "./generated/codex-app-server/schema/ReasoningEffort.js";
import type { JsonValue } from "./generated/codex-app-server/schema/serde_json/JsonValue.js";
import type { ServerNotification as CodexServerNotification } from "./generated/codex-app-server/schema/ServerNotification.js";
import type { SandboxPolicy } from "./generated/codex-app-server/schema/v2/SandboxPolicy.js";
import type { DynamicToolSpec } from "./generated/codex-app-server/schema/v2/DynamicToolSpec.js";
import type { SandboxMode as CodexSandboxMode } from "./generated/codex-app-server/schema/v2/SandboxMode.js";
import type { ThreadCompactStartParams } from "./generated/codex-app-server/schema/v2/ThreadCompactStartParams.js";
import type { ThreadResumeParams } from "./generated/codex-app-server/schema/v2/ThreadResumeParams.js";
import type { ThreadStartParams } from "./generated/codex-app-server/schema/v2/ThreadStartParams.js";
import type { UserInput as CodexUserInput } from "./generated/codex-app-server/schema/v2/UserInput.js";
import type { AskForApproval } from "./generated/codex-app-server/schema/v2/AskForApproval.js";
import type { ApprovalsReviewer } from "./generated/codex-app-server/schema/v2/ApprovalsReviewer.js";
import { mapBbReasoningLevelToCodex, parseModelsResponse } from "./models.js";
import {
  buildShellEnvironmentPolicyConfig,
  extractResultText,
} from "../shared/adapter-utils.js";
import { createStandardAdapterMembers } from "../shared/standard-adapter-members.js";
import type {
  AdapterCommand,
  PreparedProviderCommandDispatch,
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
  ProviderExecutionContext,
} from "../provider-adapter.js";
import { flattenPromptInputGroups } from "../provider-adapter.js";
import { classifySessionExecutionSettingsChange } from "../execution-options.js";
import type {
  JsonRpcMessage,
  ProviderInboundRequest,
  ProviderRuntimeEvent,
} from "../runtime-json-rpc.js";
import type { AgentRuntimeSkillRoot } from "../types.js";
import {
  applyCodexRateLimitUpdate,
  createCodexEventTranslationState,
  translateCodexEvent,
} from "./event-translation.js";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
} from "./interactive-requests.js";
import {
  codexBridgeEnvelopeSchema,
  codexRateLimitReadResponseSchema,
  codexRawResponseItemCompletedParamsSchema,
  codexThreadClosedParamsSchema,
} from "./schemas.js";
import {
  buildCodexSubAgentCompletedEvent,
  buildCodexSubAgentStartedEvent,
  parseCodexSubAgentActivityEvent,
  type CodexTrackedSubAgent,
} from "./subagent-activity-translation.js";

interface CodexPermissionSettings {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: CodexSandboxMode;
  sandboxPolicy: SandboxPolicy;
}

interface CodexThreadPermissionSettings {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: CodexSandboxMode;
}

type BbThreadStartParams = ThreadStartParams & {
  experimentalRawEvents?: boolean;
};

type BbThreadForkParams = {
  threadId: string;
  lastTurnId?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: CodexSandboxMode | null;
  config?: { [key in string]?: JsonValue } | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  dynamicTools?: DynamicToolSpec[];
};

interface ToCodexPermissionSettingsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  gitWritableRoots: readonly string[];
  options: ProviderExecutionContext;
}

interface BuildCodexConfigArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  gitWritableRoots: readonly string[];
  options?: ProviderExecutionContext;
  threadId: string;
}

interface CodexSkillsExtraRootsSetParams {
  extraRoots: string[];
}

interface CodexSkillRootPathArgs {
  skillRoot: AgentRuntimeSkillRoot;
}

interface RealpathContainedDirectoryArgs {
  candidatePath: string;
  trustedParentPath: string;
}

interface RegularFileInsideDirectoryArgs {
  filePath: string;
  trustedParentPath: string;
}

interface AddRefWritableRootsArgs {
  commonDir: string;
  headRef: string | null;
  writableRoots: string[];
}

interface AddDetachedHeadWritableRootsArgs {
  commonDir: string;
  writableRoots: string[];
}

interface AddOptionalContainedDirectoryArgs extends RealpathContainedDirectoryArgs {
  writableRoots: string[];
}

interface LinkedWorktreeGitDirBelongsToWorkspaceArgs {
  gitDir: string;
  workspaceGitFile: string;
  workspacePath: string;
}

interface RecordThreadGitWritableRootsArgs {
  threadId: string;
  writableRoots: readonly string[];
}

interface ActivateThreadGitWritableRootsArgs {
  providerThreadId: string;
  threadId: string;
}

interface ClearGitWritableRootsByBbThreadIdArgs {
  threadId: string;
}

interface ClearGitWritableRootsByProviderThreadIdArgs {
  providerThreadId: string;
}

interface PreparedWorkspaceWriteGitRoots {
  config: { [key in string]?: JsonValue } | undefined;
  permissionSettings: CodexThreadPermissionSettings;
}

interface PrepareWorkspaceWriteGitRootsArgs {
  command: CodexInstructionCommand;
}

interface ContainedDirectoryResult {
  path: string;
  status: "contained";
}

interface MissingDirectoryResult {
  status: "missing";
}

interface EscapedDirectoryResult {
  status: "escaped";
}

type RealpathContainedDirectoryResult =
  | ContainedDirectoryResult
  | MissingDirectoryResult
  | EscapedDirectoryResult;

type GitHeadState =
  | { type: "detached" }
  | { ref: string; type: "ref" }
  | { type: "unsafe" };

type CodexInstructionCommand = Extract<
  AdapterCommand,
  { type: "thread/start" | "thread/resume" | "thread/fork" }
>;

interface CodexInstructionOverrides {
  baseInstructions?: ThreadStartParams["baseInstructions"];
  developerInstructions?: ThreadStartParams["developerInstructions"];
}

function resolveCodexInstructionOverrides(
  command: CodexInstructionCommand,
): CodexInstructionOverrides {
  const instructions = command.options.instructions?.trim();
  if (!instructions) {
    return {};
  }
  if (command.instructionMode === "replace") {
    return { baseInstructions: instructions };
  }
  return { developerInstructions: instructions };
}

function codexSkillRootPath(args: CodexSkillRootPathArgs): string {
  if (args.skillRoot.providerId !== "codex") {
    throw new Error(
      `Codex cannot configure ${args.skillRoot.providerId} skill root "${args.skillRoot.id}".`,
    );
  }
  return args.skillRoot.skillDirectoryRootPath;
}

function toWorkspaceWriteCodexSandboxPolicy(
  writableRoots: readonly string[],
): SandboxPolicy {
  return {
    type: "workspaceWrite",
    writableRoots: [...writableRoots],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

function toEscalationApprovalPolicy(
  escalation: PermissionEscalation,
): AskForApproval {
  return escalation === "deny" ? "never" : "on-request";
}

function toWorkspaceApprovalPolicy(options: {
  approvalReviewer: "automatic" | "user";
  permissionEscalation: PermissionEscalation;
}): AskForApproval {
  if (options.approvalReviewer === "automatic") {
    return "on-request";
  }
  return toEscalationApprovalPolicy(options.permissionEscalation);
}

function readTextFileIfPresent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function realpathDirectoryIfPresent(directoryPath: string): string | null {
  try {
    if (!fs.statSync(directoryPath).isDirectory()) {
      return null;
    }
    return fs.realpathSync.native(directoryPath);
  } catch {
    return null;
  }
}

function regularFilePathInsideDirectoryIfPresent(
  args: RegularFileInsideDirectoryArgs,
): string | null {
  try {
    const filePath = path.normalize(args.filePath);
    if (
      !fs.lstatSync(filePath).isFile() ||
      !isPathInsideOrEqual(args.trustedParentPath, filePath)
    ) {
      return null;
    }
    return filePath;
  } catch {
    return null;
  }
}

function resolveGitPath(cwd: string, rawPath: string): string {
  return path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.normalize(path.resolve(cwd, rawPath));
}

function parseGitDirPointer(content: string): string | null {
  const firstLine = content.split(/\r?\n/u)[0]?.trim();
  if (!firstLine?.startsWith("gitdir:")) {
    return null;
  }
  const rawGitDir = firstLine.slice("gitdir:".length).trim();
  return rawGitDir.length > 0 ? rawGitDir : null;
}

function parseGitHeadState(content: string | null): GitHeadState {
  const firstLine = content?.split(/\r?\n/u)[0]?.trim();
  if (!firstLine) {
    return { type: "unsafe" };
  }
  if (!firstLine.startsWith("ref:")) {
    return /^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/u.test(firstLine)
      ? { type: "detached" }
      : { type: "unsafe" };
  }
  const ref = firstLine.slice("ref:".length).trim();
  return ref.length > 0 ? { type: "ref", ref } : { type: "unsafe" };
}

function resolveCommonGitDir(gitDir: string): string | null {
  const commonDirContent = readTextFileIfPresent(
    path.join(gitDir, "commondir"),
  );
  const commonDir = commonDirContent?.split(/\r?\n/u)[0]?.trim();
  if (!commonDir) {
    return null;
  }
  return path.isAbsolute(commonDir)
    ? path.normalize(commonDir)
    : path.normalize(path.resolve(gitDir, commonDir));
}

function linkedWorktreeGitDirBelongsToWorkspace(
  args: LinkedWorktreeGitDirBelongsToWorkspaceArgs,
): boolean {
  const rawBacklink = readTextFileIfPresent(path.join(args.gitDir, "gitdir"))
    ?.split(/\r?\n/u)[0]
    ?.trim();
  if (!rawBacklink) {
    return false;
  }

  const linkedGitFile = regularFilePathInsideDirectoryIfPresent({
    filePath: resolveGitPath(args.gitDir, rawBacklink),
    trustedParentPath: args.workspacePath,
  });
  return linkedGitFile === args.workspaceGitFile;
}

function isPathInsideOrEqual(
  parentPath: string,
  candidatePath: string,
): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative))
  );
}

/**
 * Resolves directory symlinks before containment checks so mutable Git metadata
 * cannot smuggle Codex writable roots outside the trusted common dir.
 */
function realpathContainedDirectory(
  args: RealpathContainedDirectoryArgs,
): RealpathContainedDirectoryResult {
  const realCandidatePath = realpathDirectoryIfPresent(args.candidatePath);
  if (!realCandidatePath) {
    return { status: "missing" };
  }
  if (!isPathInsideOrEqual(args.trustedParentPath, realCandidatePath)) {
    return { status: "escaped" };
  }
  return { status: "contained", path: realCandidatePath };
}

function isSafeGitHeadRef(ref: string): boolean {
  return (
    ref.startsWith("refs/") &&
    !path.isAbsolute(ref) &&
    !ref.includes("\\") &&
    !ref.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function addOptionalContainedDirectory(
  args: AddOptionalContainedDirectoryArgs,
): boolean {
  const result = realpathContainedDirectory({
    trustedParentPath: args.trustedParentPath,
    candidatePath: args.candidatePath,
  });
  switch (result.status) {
    case "contained":
      args.writableRoots.push(result.path);
      return true;
    case "missing":
      return true;
    case "escaped":
      return false;
  }
}

function addRefWritableRoots(args: AddRefWritableRootsArgs): boolean {
  if (!args.headRef || !isSafeGitHeadRef(args.headRef)) {
    return true;
  }

  // Missing ref/log dirs are valid; escaped existing dirs make the linked
  // worktree metadata untrusted, so reject all extra Git roots.
  const refsRoot = realpathContainedDirectory({
    trustedParentPath: args.commonDir,
    candidatePath: path.join(args.commonDir, "refs"),
  });
  if (refsRoot.status === "escaped") {
    return false;
  }
  if (
    refsRoot.status === "contained" &&
    !addOptionalContainedDirectory({
      trustedParentPath: refsRoot.path,
      candidatePath: path.dirname(path.join(args.commonDir, args.headRef)),
      writableRoots: args.writableRoots,
    })
  ) {
    return false;
  }

  const logsRefsRoot = realpathContainedDirectory({
    trustedParentPath: args.commonDir,
    candidatePath: path.join(args.commonDir, "logs", "refs"),
  });
  if (logsRefsRoot.status === "escaped") {
    return false;
  }
  if (
    logsRefsRoot.status === "contained" &&
    !addOptionalContainedDirectory({
      trustedParentPath: logsRefsRoot.path,
      candidatePath: path.dirname(
        path.join(args.commonDir, "logs", args.headRef),
      ),
      writableRoots: args.writableRoots,
    })
  ) {
    return false;
  }
  return true;
}

function addDetachedHeadWritableRoots(
  args: AddDetachedHeadWritableRootsArgs,
): boolean {
  return (
    addOptionalContainedDirectory({
      trustedParentPath: args.commonDir,
      candidatePath: path.join(args.commonDir, "refs", "heads"),
      writableRoots: args.writableRoots,
    }) &&
    addOptionalContainedDirectory({
      trustedParentPath: args.commonDir,
      candidatePath: path.join(args.commonDir, "logs", "refs", "heads"),
      writableRoots: args.writableRoots,
    })
  );
}

function gitWritableRootsForWorkspace(cwd: string | undefined): string[] {
  const workspacePath = cwd ? realpathDirectoryIfPresent(cwd) : null;
  if (!workspacePath) {
    return [];
  }

  const dotGitPath = path.join(workspacePath, ".git");
  const workspaceGitFile = regularFilePathInsideDirectoryIfPresent({
    filePath: dotGitPath,
    trustedParentPath: workspacePath,
  });
  if (!workspaceGitFile) {
    return [];
  }
  const dotGitContent = readTextFileIfPresent(workspaceGitFile);
  if (!dotGitContent) {
    return [];
  }
  const rawGitDir = parseGitDirPointer(dotGitContent);
  if (!rawGitDir) {
    return [];
  }
  const gitDir = realpathDirectoryIfPresent(
    resolveGitPath(workspacePath, rawGitDir),
  );
  if (!gitDir) {
    return [];
  }
  if (
    !linkedWorktreeGitDirBelongsToWorkspace({
      gitDir,
      workspaceGitFile,
      workspacePath,
    })
  ) {
    return [];
  }

  const commonDirCandidate = resolveCommonGitDir(gitDir);
  const commonDir = commonDirCandidate
    ? realpathDirectoryIfPresent(commonDirCandidate)
    : null;
  if (!commonDir) {
    return [];
  }

  const worktreesRoot = realpathContainedDirectory({
    trustedParentPath: commonDir,
    candidatePath: path.join(commonDir, "worktrees"),
  });
  if (
    worktreesRoot.status !== "contained" ||
    !isPathInsideOrEqual(worktreesRoot.path, gitDir)
  ) {
    return [];
  }

  const objectsRoot = realpathContainedDirectory({
    trustedParentPath: commonDir,
    candidatePath: path.join(commonDir, "objects"),
  });
  if (objectsRoot.status !== "contained") {
    // Missing objects or shared object stores/alternates may be legitimate Git
    // layouts, but Codex workspace-write should not follow object storage
    // outside this worktree's trusted common dir. Fall back to workspace-only
    // access.
    return [];
  }

  const writableRoots = [gitDir, objectsRoot.path];
  const headState = parseGitHeadState(
    readTextFileIfPresent(path.join(gitDir, "HEAD")),
  );
  switch (headState.type) {
    case "detached":
      if (!addDetachedHeadWritableRoots({ commonDir, writableRoots })) {
        return [];
      }
      break;
    case "ref":
      if (
        !addRefWritableRoots({
          commonDir,
          headRef: headState.ref,
          writableRoots,
        })
      ) {
        return [];
      }
      break;
    case "unsafe":
      break;
  }

  return [...new Set(writableRoots)];
}

function combineWorkspaceWriteRoots(
  roots: readonly string[],
  additionalRoots: readonly string[],
): string[] {
  return [...new Set([...additionalRoots, ...roots])];
}

function shouldCaptureWorkspaceWriteGitRoots(
  options: ProviderExecutionContext,
): boolean {
  return options.permissionScope === "workspace";
}

function toCodexApprovalsReviewer(
  options: ProviderExecutionContext,
): ApprovalsReviewer {
  return options.approvalReviewer === "automatic" ? "auto_review" : "user";
}

function toCodexThreadPermissionSettings(
  options: ProviderExecutionContext,
): CodexThreadPermissionSettings {
  const permissionPolicy = options;
  switch (permissionPolicy.permissionScope) {
    case "workspace":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(permissionPolicy),
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "workspace-write",
      };
    case "full":
      return {
        approvalPolicy: "never",
        approvalsReviewer: toCodexApprovalsReviewer(options),
        sandbox: "danger-full-access",
      };
  }
}

function toCodexPermissionSettings(
  args: ToCodexPermissionSettingsArgs,
): CodexPermissionSettings {
  const permissionPolicy = args.options;
  switch (permissionPolicy.permissionScope) {
    case "workspace":
      return {
        approvalPolicy: toWorkspaceApprovalPolicy(permissionPolicy),
        approvalsReviewer: toCodexApprovalsReviewer(args.options),
        sandbox: "workspace-write",
        sandboxPolicy: toWorkspaceWriteCodexSandboxPolicy(
          combineWorkspaceWriteRoots(
            args.gitWritableRoots,
            args.additionalWorkspaceWriteRoots,
          ),
        ),
      };
    case "full":
      return {
        approvalPolicy: "never",
        approvalsReviewer: toCodexApprovalsReviewer(args.options),
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}

export type CodexEvent = CodexServerNotification;

function toCodexServiceTier(tier: ServiceTier | undefined): "fast" | undefined {
  return tier === "fast" ? "fast" : undefined;
}

function toCodexReasoningEffort(
  reasoningLevel: ReasoningLevel,
): CodexReasoningEffort {
  const codexEffort = mapBbReasoningLevelToCodex(reasoningLevel);
  if (codexEffort == null) {
    // "none" is exposed by Cursor and some Pi models; "ultracode" is
    // Claude-specific. Codex models never expose either, so model-switch
    // reconciliation maps them away before here — but fail closed if
    // something slips through.
    throw new Error(
      `Codex does not support the ${reasoningLevel} reasoning level.`,
    );
  }
  return codexEffort;
}

function toCodexUserInput(input: PromptInput[]): CodexUserInput[] {
  return input.map((chunk): CodexUserInput => {
    switch (chunk.type) {
      case "text":
        return { type: "text", text: chunk.text, text_elements: [] };
      case "image":
        return { type: "image", url: chunk.url };
      case "localImage":
        return { type: "localImage", path: chunk.path };
      case "localFile":
        return {
          type: "text",
          text: `[Attached file: ${chunk.path}]`,
          text_elements: [],
        };
    }
  });
}

function buildCodexConfig(
  args: BuildCodexConfigArgs,
): { [key in string]?: JsonValue } | undefined {
  const config: { [key in string]?: JsonValue } = {};
  if (args.threadId) {
    config["shell_environment_policy.set.BB_THREAD_ID"] = args.threadId;
  }
  const shellEnvironmentConfig = buildShellEnvironmentPolicyConfig(
    args.options?.envVars,
  );
  if (shellEnvironmentConfig) {
    Object.assign(config, shellEnvironmentConfig);
  }
  if (args.options?.reasoningLevel) {
    config["model_reasoning_effort"] = toCodexReasoningEffort(
      args.options.reasoningLevel,
    );
  }
  config["features.default_mode_request_user_input"] = false;
  if (args.options?.providerSubagentsEnabled === false) {
    config["features.multi_agent"] = false;
    config["features.multi_agent_v2.max_concurrent_threads_per_session"] = 1;
  }
  config["memories.use_memories"] = args.options?.memoryEnabled ?? true;
  config["memories.generate_memories"] = args.options?.memoryEnabled ?? true;
  if (args.options?.permissionScope === "workspace") {
    const writableRoots = combineWorkspaceWriteRoots(
      args.gitWritableRoots,
      args.additionalWorkspaceWriteRoots,
    );
    if (writableRoots.length > 0) {
      config["sandbox_workspace_write.writable_roots"] = [...writableRoots];
    }
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

type CodexDynamicToolCommand = Extract<
  AdapterCommand,
  { type: "thread/start" | "thread/resume" | "thread/fork" }
>;

function toCodexDynamicTools(
  dynamicTools: CodexDynamicToolCommand["dynamicTools"],
): DynamicToolSpec[] | undefined {
  return dynamicTools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: jsonValueSchema.parse(tool.inputSchema),
  }));
}

// Raw shell output recovery is a two-phase flow:
// 1. `rawResponseItem/completed` for shell `function_call` and
//    `function_call_output` events is consumed into per-thread state keyed by
//    the provider's `call_id`.
// 2. The later normalized `item/completed` commandExecution consumes that
//    stored state to repair the authoritative final output.
const CODEX_SHELL_TOOL_NAMES = new Set(["exec_command", "Bash", "bash"]);
const CODEX_DELEGATION_TOOL_NAMES = new Set(["spawnAgent", "resumeAgent"]);
const TOOL_OUTPUT_MARKER_LINE = "Output:";
const TOOL_OUTPUT_METADATA_PREFIXES = [
  "Chunk ID:",
  "Wall time:",
  "Process exited with code ",
  "Original token count:",
];
// TODO(codex): Delete this compatibility shim once app-server exposes
// structured stdout/stderr for shell tools. rawResponseItem/completed currently
// carries UI-formatted text, so recovery must stay conservative and avoid
// persisting wrapper metadata when the framing shape is ambiguous.

interface CodexRecoveredCommandOutput {
  kind: "recovered";
  output: string;
}

interface CodexEmptyCommandOutput {
  kind: "empty";
}

interface CodexUnparseableCommandOutput {
  kind: "unparseable";
}

type CodexCapturedCommandOutput =
  | CodexRecoveredCommandOutput
  | CodexEmptyCommandOutput;
type CodexParsedCommandOutput =
  | CodexCapturedCommandOutput
  | CodexUnparseableCommandOutput;

interface CodexRawCommandOutputState {
  capturedCommandOutputByCallId: Map<string, CodexCapturedCommandOutput>;
  pendingCompletedEventByCallId: Map<string, ThreadEvent>;
  shellToolCallIds: Set<string>;
}

interface CodexDelegationToolCall {
  callId: string;
  receiverThreadIds: string[];
  senderThreadId?: string;
}

interface CodexPendingDelegationTurnLink {
  callId: string;
  parentTurnId: string;
}

function collectStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function getCodexDelegationToolCall(
  event: ThreadEvent,
): CodexDelegationToolCall | null {
  if (
    (event.type !== "item/started" && event.type !== "item/completed") ||
    event.item.type !== "toolCall" ||
    !CODEX_DELEGATION_TOOL_NAMES.has(event.item.tool)
  ) {
    return null;
  }

  return {
    callId: event.item.id,
    receiverThreadIds: collectStringArray(
      event.item.arguments?.receiverThreadIds,
    ),
    senderThreadId:
      typeof event.item.arguments?.senderThreadId === "string" &&
      event.item.arguments.senderThreadId.length > 0
        ? event.item.arguments.senderThreadId
        : undefined,
  };
}

function getCodexEventProviderThreadId(event: ThreadEvent): string | undefined {
  if (
    "providerThreadId" in event &&
    typeof event.providerThreadId === "string" &&
    event.providerThreadId.length > 0
  ) {
    return event.providerThreadId;
  }
  return undefined;
}

function getCodexEventParentToolCallId(event: ThreadEvent): string | undefined {
  switch (event.type) {
    case "item/started":
    case "item/completed":
      return event.item.parentToolCallId;
    case "turn/started":
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
    case "provider/unhandled":
      return event.parentToolCallId;
    default:
      return undefined;
  }
}

function withCodexParentToolCallId(
  event: ThreadEvent,
  parentToolCallId: string,
): ThreadEvent {
  if (getCodexEventParentToolCallId(event)) {
    return event;
  }

  switch (event.type) {
    case "turn/started":
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
    case "provider/unhandled":
      return { ...event, parentToolCallId };
    case "item/started":
    case "item/completed":
      return {
        ...event,
        item: { ...event.item, parentToolCallId },
      };
    default:
      return event;
  }
}

function toCodexRawNotification(
  event: ProviderRuntimeEvent,
  expectedMethod?: string,
): JsonRpcMessage | null {
  const rawMethod = typeof event.method === "string" ? event.method : undefined;
  if (expectedMethod && rawMethod !== expectedMethod) {
    return null;
  }
  const envelope = codexBridgeEnvelopeSchema.safeParse(event);
  if (!envelope.success) {
    return null;
  }
  return {
    jsonrpc: "2.0",
    method: envelope.data.method,
    ...(envelope.data.params ? { params: envelope.data.params } : {}),
  };
}

function normalizeCommandOutputNewlines(output: string): string {
  return output.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

interface ParsedCodexOutputLine {
  line: string;
  nextIndex: number;
}

function readCodexOutputLine(
  text: string,
  startIndex: number,
): ParsedCodexOutputLine {
  const nextNewlineIndex = text.indexOf("\n", startIndex);
  if (nextNewlineIndex === -1) {
    return {
      line: text.slice(startIndex),
      nextIndex: text.length,
    };
  }
  return {
    line: text.slice(startIndex, nextNewlineIndex),
    nextIndex: nextNewlineIndex + 1,
  };
}

function isCodexToolOutputMetadataLine(line: string): boolean {
  return TOOL_OUTPUT_METADATA_PREFIXES.some((prefix) =>
    line.startsWith(prefix),
  );
}

function toCapturedCodexCommandOutput(
  output: string,
): CodexCapturedCommandOutput {
  return output.length === 0
    ? { kind: "empty" }
    : { kind: "recovered", output };
}

function findCodexOutputMarkerNextIndex(
  text: string,
  startIndex: number,
): number | null {
  let cursor = startIndex;
  while (cursor <= text.length) {
    const { line, nextIndex } = readCodexOutputLine(text, cursor);
    if (line === TOOL_OUTPUT_MARKER_LINE) {
      return nextIndex;
    }
    if (nextIndex >= text.length) {
      return null;
    }
    cursor = nextIndex;
  }
  return null;
}

function extractRecoveredCommandOutput(
  rawToolOutput: unknown,
): CodexParsedCommandOutput {
  const text = normalizeCommandOutputNewlines(extractResultText(rawToolOutput));
  if (text.length === 0) {
    return { kind: "empty" };
  }

  const firstLine = readCodexOutputLine(text, 0);
  if (firstLine.line === TOOL_OUTPUT_MARKER_LINE) {
    return toCapturedCodexCommandOutput(text.slice(firstLine.nextIndex));
  }

  if (!isCodexToolOutputMetadataLine(firstLine.line)) {
    return toCapturedCodexCommandOutput(text);
  }

  let cursor = firstLine.nextIndex;
  let metadataLineCount = 1;
  while (cursor <= text.length) {
    const { line, nextIndex } = readCodexOutputLine(text, cursor);
    if (line === TOOL_OUTPUT_MARKER_LINE) {
      return toCapturedCodexCommandOutput(text.slice(nextIndex));
    }
    if (!isCodexToolOutputMetadataLine(line)) {
      return findCodexOutputMarkerNextIndex(text, cursor) === null
        ? toCapturedCodexCommandOutput(text)
        : { kind: "unparseable" };
    }
    metadataLineCount += 1;
    if (nextIndex >= text.length) {
      return metadataLineCount === 1
        ? toCapturedCodexCommandOutput(text)
        : { kind: "unparseable" };
    }
    cursor = nextIndex;
  }

  return { kind: "unparseable" };
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export interface CreateCodexProviderAdapterOptions extends ProviderAdapterFactoryOptions {
  processCommand?: string;
  processArgs?: string[];
}

export function createCodexProviderAdapter(
  opts?: CreateCodexProviderAdapterOptions,
): ProviderAdapter {
  const additionalWorkspaceWriteRoots =
    opts?.additionalWorkspaceWriteRoots ?? [];
  const providerInfo = getBuiltInAgentProviderInfo("codex");
  const capabilities = providerInfo.capabilities;
  const eventTranslationState = createCodexEventTranslationState();
  const nativeTurnStartClientRequestIdsByProviderThreadId = new Map<
    string,
    ClientTurnRequestId[]
  >();
  const pendingWorkspaceWriteGitWritableRootsByThreadId = new Map<
    string,
    string[]
  >();
  const workspaceWriteGitWritableRootsByThreadId = new Map<string, string[]>();
  const bbThreadIdByProviderThreadId = new Map<string, string>();
  const rawCommandOutputStateByProviderThreadId = new Map<
    string,
    CodexRawCommandOutputState
  >();
  const delegationParentToolCallIdsByProviderThreadId = new Map<
    string,
    string
  >();
  const delegationParentToolCallIdsByTurnId = new Map<string, string>();
  const pendingDelegationTurnLinksByProviderThreadId = new Map<
    string,
    CodexPendingDelegationTurnLink[]
  >();
  const pendingDelegationCallIds = new Set<string>();
  const pendingDelegationProviderThreadIdByCallId = new Map<string, string>();
  const processedSubAgentInteractionIds = new Set<string>();
  const trackedSubAgentsByCallId = new Map<string, CodexTrackedSubAgent>();
  const trackedSubAgentCallIdsByAgentThreadId = new Map<string, string>();

  function stageThreadGitWritableRoots(
    args: RecordThreadGitWritableRootsArgs,
  ): void {
    pendingWorkspaceWriteGitWritableRootsByThreadId.set(args.threadId, [
      ...args.writableRoots,
    ]);
  }

  function activateThreadGitWritableRoots(
    args: ActivateThreadGitWritableRootsArgs,
  ): void {
    const writableRoots = pendingWorkspaceWriteGitWritableRootsByThreadId.get(
      args.threadId,
    );
    if (!writableRoots) {
      return;
    }
    pendingWorkspaceWriteGitWritableRootsByThreadId.delete(args.threadId);
    workspaceWriteGitWritableRootsByThreadId.set(args.threadId, [
      ...writableRoots,
    ]);
    bbThreadIdByProviderThreadId.set(args.providerThreadId, args.threadId);
  }

  function clearGitWritableRootsByBbThreadId(
    args: ClearGitWritableRootsByBbThreadIdArgs,
  ): void {
    pendingWorkspaceWriteGitWritableRootsByThreadId.delete(args.threadId);
    workspaceWriteGitWritableRootsByThreadId.delete(args.threadId);
    for (const [providerThreadId, threadId] of bbThreadIdByProviderThreadId) {
      if (threadId === args.threadId) {
        bbThreadIdByProviderThreadId.delete(providerThreadId);
      }
    }
  }

  function clearGitWritableRootsByProviderThreadId(
    args: ClearGitWritableRootsByProviderThreadIdArgs,
  ): void {
    const threadId = bbThreadIdByProviderThreadId.get(args.providerThreadId);
    bbThreadIdByProviderThreadId.delete(args.providerThreadId);
    if (!threadId) {
      return;
    }
    clearGitWritableRootsByBbThreadId({ threadId });
  }

  function prepareWorkspaceWriteGitRoots(
    args: PrepareWorkspaceWriteGitRootsArgs,
  ): PreparedWorkspaceWriteGitRoots {
    const command = args.command;
    const captureWorkspaceWriteGitRoots = shouldCaptureWorkspaceWriteGitRoots(
      command.options,
    );
    const writableRoots = captureWorkspaceWriteGitRoots
      ? gitWritableRootsForWorkspace(command.cwd)
      : [];
    if (captureWorkspaceWriteGitRoots) {
      stageThreadGitWritableRoots({
        threadId: command.threadId,
        writableRoots,
      });
    } else {
      clearGitWritableRootsByBbThreadId({ threadId: command.threadId });
    }
    return {
      config: buildCodexConfig({
        additionalWorkspaceWriteRoots,
        gitWritableRoots: writableRoots,
        options: command.options,
        threadId: command.threadId,
      }),
      permissionSettings: toCodexThreadPermissionSettings(command.options),
    };
  }

  function getRawCommandOutputState(
    providerThreadId: string,
  ): CodexRawCommandOutputState {
    const existingState =
      rawCommandOutputStateByProviderThreadId.get(providerThreadId);
    if (existingState) {
      return existingState;
    }

    const nextState: CodexRawCommandOutputState = {
      capturedCommandOutputByCallId: new Map<
        string,
        CodexCapturedCommandOutput
      >(),
      pendingCompletedEventByCallId: new Map<string, ThreadEvent>(),
      shellToolCallIds: new Set<string>(),
    };
    rawCommandOutputStateByProviderThreadId.set(providerThreadId, nextState);
    return nextState;
  }

  function pruneRawCommandOutputState(providerThreadId: string): void {
    const state = rawCommandOutputStateByProviderThreadId.get(providerThreadId);
    if (!state) {
      return;
    }
    if (
      state.capturedCommandOutputByCallId.size === 0 &&
      state.pendingCompletedEventByCallId.size === 0 &&
      state.shellToolCallIds.size === 0
    ) {
      rawCommandOutputStateByProviderThreadId.delete(providerThreadId);
    }
  }

  function clearClosedThreadState(event: ProviderRuntimeEvent): void {
    const rawEvent = toCodexRawNotification(event, "thread/closed");
    if (!rawEvent) {
      return;
    }
    const paramsResult = codexThreadClosedParamsSchema.safeParse(
      rawEvent.params,
    );
    if (!paramsResult.success) {
      return;
    }
    rawCommandOutputStateByProviderThreadId.delete(paramsResult.data.threadId);
    clearCodexDelegationParentState(paramsResult.data.threadId);
    clearGitWritableRootsByProviderThreadId({
      providerThreadId: paramsResult.data.threadId,
    });
  }

  function clearCodexDelegationParentState(providerThreadId: string): void {
    delegationParentToolCallIdsByProviderThreadId.delete(providerThreadId);
    pendingDelegationTurnLinksByProviderThreadId.delete(providerThreadId);
    for (const [callId, tracked] of trackedSubAgentsByCallId) {
      if (
        tracked.parentProviderThreadId !== providerThreadId &&
        tracked.agentThreadId !== providerThreadId
      ) {
        continue;
      }
      clearTrackedSubAgentLinks(tracked);
      if (
        trackedSubAgentCallIdsByAgentThreadId.get(tracked.agentThreadId) ===
        tracked.callId
      ) {
        trackedSubAgentCallIdsByAgentThreadId.delete(tracked.agentThreadId);
      }
      trackedSubAgentsByCallId.delete(callId);
    }
  }

  function queueNativeTurnStartClientRequestId(args: {
    clientRequestId: ClientTurnRequestId | undefined;
    providerThreadId: string | undefined;
  }): PreparedProviderCommandDispatch | null {
    if (
      args.clientRequestId === undefined ||
      args.providerThreadId === undefined
    ) {
      return null;
    }
    const clientRequestId = args.clientRequestId;
    const providerThreadId = args.providerThreadId;
    nativeTurnStartClientRequestIdsByProviderThreadId.set(providerThreadId, [
      ...(nativeTurnStartClientRequestIdsByProviderThreadId.get(
        providerThreadId,
      ) ?? []),
      clientRequestId,
    ]);

    return {
      rollback: () => {
        removeNativeTurnStartClientRequestId({
          clientRequestId,
          providerThreadId,
        });
      },
    };
  }

  function removeNativeTurnStartClientRequestId(args: {
    clientRequestId: ClientTurnRequestId;
    providerThreadId: string;
  }): void {
    const sequences = nativeTurnStartClientRequestIdsByProviderThreadId.get(
      args.providerThreadId,
    );
    if (!sequences || sequences.length === 0) {
      return;
    }
    const nextSequences = [...sequences];
    const sequenceIndex = nextSequences.indexOf(args.clientRequestId);
    if (sequenceIndex === -1) {
      return;
    }
    nextSequences.splice(sequenceIndex, 1);
    if (nextSequences.length === 0) {
      nativeTurnStartClientRequestIdsByProviderThreadId.delete(
        args.providerThreadId,
      );
      return;
    }
    nativeTurnStartClientRequestIdsByProviderThreadId.set(
      args.providerThreadId,
      nextSequences,
    );
  }

  function shiftNativeTurnStartClientRequestId(
    providerThreadId: string,
  ): ClientTurnRequestId | undefined {
    const sequences =
      nativeTurnStartClientRequestIdsByProviderThreadId.get(providerThreadId);
    if (!sequences || sequences.length === 0) {
      return undefined;
    }
    const [clientRequestId, ...remainingSequences] = sequences;
    if (remainingSequences.length === 0) {
      nativeTurnStartClientRequestIdsByProviderThreadId.delete(
        providerThreadId,
      );
    } else {
      nativeTurnStartClientRequestIdsByProviderThreadId.set(
        providerThreadId,
        remainingSequences,
      );
    }
    return clientRequestId;
  }

  function attachAcceptedUserMessageCorrelation(
    event: ThreadEvent,
  ): ThreadEvent[] {
    if (event.type === "turn/completed") {
      if (event.providerThreadId !== null) {
        nativeTurnStartClientRequestIdsByProviderThreadId.delete(
          event.providerThreadId,
        );
      }
      return [event];
    }

    if (event.type === "turn/started") {
      const clientRequestId = shiftNativeTurnStartClientRequestId(
        event.providerThreadId,
      );
      if (clientRequestId === undefined) {
        return [event];
      }
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      return [
        event,
        {
          type: "turn/input/accepted",
          threadId: event.threadId,
          providerThreadId: event.providerThreadId,
          scope: turnScope(turnId),
          clientRequestId,
        },
      ];
    }

    if (
      (event.type !== "item/started" && event.type !== "item/completed") ||
      event.item.type !== "userMessage"
    ) {
      return [event];
    }

    return [];
  }

  function enqueuePendingDelegationTurnLink(args: {
    callId: string;
    parentTurnId: string | undefined;
    providerThreadId: string | undefined;
  }): void {
    if (!args.providerThreadId || !args.parentTurnId) {
      return;
    }
    if (pendingDelegationCallIds.has(args.callId)) {
      return;
    }

    const pendingLinks =
      pendingDelegationTurnLinksByProviderThreadId.get(args.providerThreadId) ??
      [];
    pendingLinks.push({
      callId: args.callId,
      parentTurnId: args.parentTurnId,
    });
    pendingDelegationTurnLinksByProviderThreadId.set(
      args.providerThreadId,
      pendingLinks,
    );
    pendingDelegationCallIds.add(args.callId);
    pendingDelegationProviderThreadIdByCallId.set(
      args.callId,
      args.providerThreadId,
    );
  }

  function removePendingDelegationCall(callId: string): void {
    pendingDelegationCallIds.delete(callId);
    const providerThreadId =
      pendingDelegationProviderThreadIdByCallId.get(callId);
    pendingDelegationProviderThreadIdByCallId.delete(callId);
    if (!providerThreadId) {
      return;
    }
    const pendingLinks =
      pendingDelegationTurnLinksByProviderThreadId.get(providerThreadId);
    if (!pendingLinks) {
      return;
    }
    const remainingLinks = pendingLinks.filter(
      (pendingLink) => pendingLink.callId !== callId,
    );
    if (remainingLinks.length === 0) {
      pendingDelegationTurnLinksByProviderThreadId.delete(providerThreadId);
    } else if (remainingLinks.length !== pendingLinks.length) {
      pendingDelegationTurnLinksByProviderThreadId.set(
        providerThreadId,
        remainingLinks,
      );
    }
  }

  function hasPendingNativeTurnStart(providerThreadId: string): boolean {
    return (
      (nativeTurnStartClientRequestIdsByProviderThreadId.get(providerThreadId)
        ?.length ?? 0) > 0
    );
  }

  function clearTrackedSubAgentLinks(tracked: CodexTrackedSubAgent): void {
    removePendingDelegationCall(tracked.callId);
    if (
      delegationParentToolCallIdsByProviderThreadId.get(
        tracked.agentThreadId,
      ) === tracked.callId
    ) {
      delegationParentToolCallIdsByProviderThreadId.delete(
        tracked.agentThreadId,
      );
    }
    for (const [
      turnId,
      parentToolCallId,
    ] of delegationParentToolCallIdsByTurnId) {
      if (parentToolCallId === tracked.callId) {
        delegationParentToolCallIdsByTurnId.delete(turnId);
      }
    }
  }

  function consumePendingDelegationTurnLink(args: {
    providerThreadId: string | undefined;
    turnId: string;
  }): string | undefined {
    if (!args.providerThreadId) {
      return undefined;
    }
    if (delegationParentToolCallIdsByTurnId.has(args.turnId)) {
      return delegationParentToolCallIdsByTurnId.get(args.turnId);
    }

    const pendingLinks = pendingDelegationTurnLinksByProviderThreadId.get(
      args.providerThreadId,
    );
    if (!pendingLinks || pendingLinks.length === 0) {
      return undefined;
    }

    while (pendingLinks.length > 0) {
      const pendingLink = pendingLinks.shift();
      if (!pendingLink || pendingLink.parentTurnId === args.turnId) {
        continue;
      }
      if (pendingLinks.length === 0) {
        pendingDelegationTurnLinksByProviderThreadId.delete(
          args.providerThreadId,
        );
      }
      delegationParentToolCallIdsByTurnId.set(args.turnId, pendingLink.callId);
      return pendingLink.callId;
    }

    pendingDelegationTurnLinksByProviderThreadId.delete(args.providerThreadId);
    return undefined;
  }

  function attachCodexDelegationParentLink(event: ThreadEvent): ThreadEvent {
    const providerThreadId = getCodexEventProviderThreadId(event);
    const turnId = getThreadEventScopeTurnId(event.scope);
    let parentToolCallId =
      getCodexEventParentToolCallId(event) ??
      (turnId ? delegationParentToolCallIdsByTurnId.get(turnId) : undefined);

    if (!parentToolCallId && event.type === "turn/started") {
      const startedTurnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      const mappedFromProviderThread = providerThreadId
        ? delegationParentToolCallIdsByProviderThreadId.get(providerThreadId)
        : undefined;
      if (mappedFromProviderThread) {
        parentToolCallId = mappedFromProviderThread;
        // A turn that matches an explicit agent-thread mapping must not also
        // consume a different agent's FIFO slot on the multiplexed root.
        removePendingDelegationCall(mappedFromProviderThread);
      } else if (
        !providerThreadId ||
        !hasPendingNativeTurnStart(providerThreadId)
      ) {
        parentToolCallId = consumePendingDelegationTurnLink({
          providerThreadId,
          turnId: startedTurnId,
        });
      }
    }

    if (!parentToolCallId && providerThreadId) {
      parentToolCallId =
        delegationParentToolCallIdsByProviderThreadId.get(providerThreadId);
    }

    if (event.type === "turn/started" && parentToolCallId) {
      delegationParentToolCallIdsByTurnId.set(
        requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        }),
        parentToolCallId,
      );
    }

    return parentToolCallId
      ? withCodexParentToolCallId(event, parentToolCallId)
      : event;
  }

  function observeCodexDelegationToolCall(event: ThreadEvent): void {
    const delegationToolCall = getCodexDelegationToolCall(event);
    if (!delegationToolCall) {
      return;
    }

    const providerThreadId = getCodexEventProviderThreadId(event);
    for (const receiverThreadId of delegationToolCall.receiverThreadIds) {
      if (
        receiverThreadId === providerThreadId ||
        receiverThreadId === delegationToolCall.senderThreadId
      ) {
        enqueuePendingDelegationTurnLink({
          callId: delegationToolCall.callId,
          parentTurnId: getThreadEventScopeTurnId(event.scope),
          providerThreadId,
        });
        continue;
      }
      delegationParentToolCallIdsByProviderThreadId.set(
        receiverThreadId,
        delegationToolCall.callId,
      );
    }

    if (delegationToolCall.receiverThreadIds.length === 0) {
      enqueuePendingDelegationTurnLink({
        callId: delegationToolCall.callId,
        parentTurnId: getThreadEventScopeTurnId(event.scope),
        providerThreadId,
      });
    }
  }

  function attachCodexDelegationParentLinks(
    events: ThreadEvent[],
  ): ThreadEvent[] {
    return events.map((event) => {
      const parentLinkedEvent = attachCodexDelegationParentLink(event);
      observeCodexDelegationToolCall(parentLinkedEvent);
      return parentLinkedEvent;
    });
  }

  function findTrackedSubAgentByAgentThreadId(
    agentThreadId: string,
  ): CodexTrackedSubAgent | undefined {
    // Keep this map after a child settles so resume does not scan every
    // historical agent. Thread close is the only cleanup.
    const callId = trackedSubAgentCallIdsByAgentThreadId.get(agentThreadId);
    if (!callId) {
      return undefined;
    }
    return trackedSubAgentsByCallId.get(callId);
  }

  function rearmTrackedSubAgent(tracked: CodexTrackedSubAgent): void {
    trackedSubAgentCallIdsByAgentThreadId.set(
      tracked.agentThreadId,
      tracked.callId,
    );
    if (tracked.agentThreadId !== tracked.parentProviderThreadId) {
      delegationParentToolCallIdsByProviderThreadId.set(
        tracked.agentThreadId,
        tracked.callId,
      );
    }
    enqueuePendingDelegationTurnLink({
      callId: tracked.callId,
      parentTurnId: tracked.parentTurnId,
      providerThreadId: tracked.parentProviderThreadId,
    });
  }

  function completeCodexTrackedSubAgent(args: {
    status: "completed" | "failed" | "interrupted";
    tracked: CodexTrackedSubAgent;
  }): ThreadEvent | null {
    const alreadyTerminal = args.tracked.terminal;
    args.tracked.terminal = true;
    clearTrackedSubAgentLinks(args.tracked);
    if (alreadyTerminal && args.tracked.pendingFollowups > 0) {
      args.tracked.pendingFollowups -= 1;
    }
    if (args.tracked.pendingFollowups > 0) {
      rearmTrackedSubAgent(args.tracked);
    }
    if (alreadyTerminal) {
      return null;
    }
    return buildCodexSubAgentCompletedEvent(args);
  }

  function translateCodexSubAgentActivity(
    event: ProviderRuntimeEvent,
  ): ThreadEvent[] | null {
    const activity = parseCodexSubAgentActivityEvent(event);
    if (!activity) {
      return null;
    }

    switch (activity.item.kind) {
      case "started": {
        if (trackedSubAgentsByCallId.has(activity.item.id)) {
          return [];
        }
        const tracked: CodexTrackedSubAgent = {
          agentPath: activity.item.agentPath,
          agentThreadId: activity.item.agentThreadId,
          callId: activity.item.id,
          parentProviderThreadId: activity.providerThreadId,
          parentTurnId: activity.turnId,
          pendingFollowups: 0,
          terminal: false,
        };
        trackedSubAgentsByCallId.set(tracked.callId, tracked);
        trackedSubAgentCallIdsByAgentThreadId.set(
          tracked.agentThreadId,
          tracked.callId,
        );

        const [startedEvent] = attachCodexDelegationParentLinks([
          buildCodexSubAgentStartedEvent(tracked),
        ]);
        if (
          startedEvent?.type === "item/started" &&
          startedEvent.item.type === "toolCall"
        ) {
          tracked.parentToolCallId = startedEvent.item.parentToolCallId;
        }
        // Codex currently multiplexes child turns onto the root provider
        // thread, even though the activity includes a distinct agent thread
        // id. Queue a FIFO fallback in addition to the explicit id mapping.
        enqueuePendingDelegationTurnLink({
          callId: tracked.callId,
          parentTurnId: tracked.parentTurnId,
          providerThreadId: tracked.parentProviderThreadId,
        });
        return startedEvent ? [startedEvent] : [];
      }
      case "interacted": {
        // Messaging an existing agent is activity within the original
        // delegation, not a new timeline row. A completed agent can receive
        // followup_task; re-arm the original parent so the next child turn
        // is not projected as a root turn.
        if (processedSubAgentInteractionIds.has(activity.item.id)) {
          return [];
        }
        processedSubAgentInteractionIds.add(activity.item.id);
        const tracked = findTrackedSubAgentByAgentThreadId(
          activity.item.agentThreadId,
        );
        if (tracked?.terminal) {
          tracked.pendingFollowups += 1;
          rearmTrackedSubAgent(tracked);
        }
        return [];
      }
      case "interrupted": {
        const callId = trackedSubAgentCallIdsByAgentThreadId.get(
          activity.item.agentThreadId,
        );
        const tracked = callId
          ? trackedSubAgentsByCallId.get(callId)
          : undefined;
        if (!tracked) {
          return [];
        }
        const completed = completeCodexTrackedSubAgent({
          tracked,
          status: "interrupted",
        });
        return completed ? [completed] : [];
      }
    }
  }

  function completeFinishedCodexSubAgentTurns(
    events: ThreadEvent[],
  ): ThreadEvent[] {
    const completedEvents: ThreadEvent[] = [];
    for (const event of events) {
      completedEvents.push(event);
      if (event.type !== "turn/completed") {
        continue;
      }
      const turnId = requireThreadEventScopeTurnId({
        type: event.type,
        scope: event.scope,
      });
      const callId = delegationParentToolCallIdsByTurnId.get(turnId);
      const tracked = callId ? trackedSubAgentsByCallId.get(callId) : undefined;
      if (!tracked) {
        continue;
      }
      const completed = completeCodexTrackedSubAgent({
        tracked,
        status: event.status,
      });
      if (completed) {
        completedEvents.push(completed);
      }
    }
    return completedEvents;
  }

  function consumeCodexRawResponseItem(
    event: ProviderRuntimeEvent,
  ): ThreadEvent[] | null {
    const rawEvent = toCodexRawNotification(event, "rawResponseItem/completed");
    if (!rawEvent) {
      return null;
    }

    const paramsResult = codexRawResponseItemCompletedParamsSchema.safeParse(
      rawEvent.params,
    );
    if (!paramsResult.success) {
      return [];
    }

    const { threadId: providerThreadId, item } = paramsResult.data;

    if (item.type === "function_call") {
      if (!CODEX_SHELL_TOOL_NAMES.has(item.name)) {
        return [];
      }
      getRawCommandOutputState(providerThreadId).shellToolCallIds.add(
        item.call_id,
      );
      return [];
    }

    if (item.type === "function_call_output") {
      const rawCommandOutputState =
        rawCommandOutputStateByProviderThreadId.get(providerThreadId);
      if (!rawCommandOutputState) {
        return [];
      }
      if (!rawCommandOutputState.shellToolCallIds.has(item.call_id)) {
        pruneRawCommandOutputState(providerThreadId);
        return [];
      }

      const recoveredOutput = extractRecoveredCommandOutput(item.output);
      if (recoveredOutput.kind !== "unparseable") {
        rawCommandOutputState.capturedCommandOutputByCallId.set(
          item.call_id,
          recoveredOutput,
        );
      } else {
        rawCommandOutputState.shellToolCallIds.delete(item.call_id);
      }
      const pendingCompletedEvent =
        rawCommandOutputState.pendingCompletedEventByCallId.get(item.call_id);
      if (pendingCompletedEvent) {
        rawCommandOutputState.pendingCompletedEventByCallId.delete(
          item.call_id,
        );
        const capturedOutput = consumeCapturedCommandOutput({
          commandExecutionId: item.call_id,
          providerThreadId,
        });
        return [
          repairCompletedCommandOutput(pendingCompletedEvent, capturedOutput),
        ];
      }
      pruneRawCommandOutputState(providerThreadId);
      return [];
    }

    if (item.type === "local_shell_call") {
      // TODO(codex): The checked-in live raw fixture currently shows shell
      // execution as function_call(exec_command) + function_call_output. If
      // app-server starts emitting local_shell_call with recoverable output,
      // extend this repair path with a real captured fixture first.
      return [];
    }

    if (
      item.type === "custom_tool_call" ||
      item.type === "custom_tool_call_output"
    ) {
      // TODO(codex): Keep this explicit so shell recovery does not silently
      // assume custom_tool_call traffic is equivalent to exec_command.
      return [];
    }

    return [];
  }

  function reconcileRawCommandOutputLifecycle(
    events: ThreadEvent[],
  ): ThreadEvent[] {
    const reconciledEvents: ThreadEvent[] = [];
    for (const event of events) {
      if (event.type === "turn/completed") {
        if (event.providerThreadId !== null) {
          const state = rawCommandOutputStateByProviderThreadId.get(
            event.providerThreadId,
          );
          if (state) {
            reconciledEvents.push(
              ...state.pendingCompletedEventByCallId.values(),
            );
          }
          rawCommandOutputStateByProviderThreadId.delete(
            event.providerThreadId,
          );
        }
      }
      reconciledEvents.push(event);
    }
    return reconciledEvents;
  }

  function consumeCapturedCommandOutput(args: {
    commandExecutionId: string;
    providerThreadId: string;
  }): CodexCapturedCommandOutput | undefined {
    const rawCommandOutputState = rawCommandOutputStateByProviderThreadId.get(
      args.providerThreadId,
    );
    if (!rawCommandOutputState) {
      return undefined;
    }

    const capturedOutput =
      rawCommandOutputState.capturedCommandOutputByCallId.get(
        args.commandExecutionId,
      );
    rawCommandOutputState.shellToolCallIds.delete(args.commandExecutionId);
    rawCommandOutputState.capturedCommandOutputByCallId.delete(
      args.commandExecutionId,
    );
    pruneRawCommandOutputState(args.providerThreadId);
    return capturedOutput;
  }

  function repairCompletedCommandOutput(
    event: ThreadEvent,
    capturedOutput: CodexCapturedCommandOutput | undefined,
  ): ThreadEvent {
    if (
      capturedOutput === undefined ||
      event.type !== "item/completed" ||
      event.item.type !== "commandExecution"
    ) {
      return event;
    }

    if (
      capturedOutput.kind === "recovered" &&
      event.item.aggregatedOutput === capturedOutput.output
    ) {
      return event;
    }

    if (capturedOutput.kind === "empty") {
      if (event.item.aggregatedOutput === undefined) {
        return event;
      }
      const { aggregatedOutput: _aggregatedOutput, ...itemWithoutOutput } =
        event.item;
      return {
        ...event,
        item: itemWithoutOutput,
      };
    }

    return {
      ...event,
      item: {
        ...event.item,
        aggregatedOutput: capturedOutput.output,
      },
    };
  }

  function applyRecoveredCommandOutput(events: ThreadEvent[]): ThreadEvent[] {
    const repairedEvents: ThreadEvent[] = [];
    for (const event of events) {
      if (
        event.type !== "item/completed" ||
        event.item.type !== "commandExecution"
      ) {
        repairedEvents.push(event);
        continue;
      }

      const rawCommandOutputState = rawCommandOutputStateByProviderThreadId.get(
        event.providerThreadId,
      );
      if (
        !rawCommandOutputState?.capturedCommandOutputByCallId.has(event.item.id)
      ) {
        if (rawCommandOutputState?.shellToolCallIds.has(event.item.id)) {
          rawCommandOutputState.pendingCompletedEventByCallId.set(
            event.item.id,
            event,
          );
          continue;
        }
        repairedEvents.push(event);
        continue;
      }
      const capturedOutput = consumeCapturedCommandOutput({
        commandExecutionId: event.item.id,
        providerThreadId: event.providerThreadId,
      });
      repairedEvents.push(repairCompletedCommandOutput(event, capturedOutput));
    }
    return repairedEvents;
  }

  function buildPostInitializeRequests() {
    return [
      {
        plan: {
          kind: "request" as const,
          method: "account/rateLimits/read",
        },
        required: false,
        onResult(result: unknown) {
          const response = codexRateLimitReadResponseSchema.parse(result);
          applyCodexRateLimitUpdate(eventTranslationState, response.rateLimits);
        },
      },
    ];
  }

  const standardAdapterMembers = createStandardAdapterMembers({
    id: providerInfo.id,
    displayName: providerInfo.displayName,
    capabilities,
    approvalRequestPolicy: "runtime",
    classifyExecutionSettingsChange: classifySessionExecutionSettingsChange,
    // Codex app-server connections are owned by the runtime process manager.
    // BB runs live Codex threads on thread-scoped app-server processes, while
    // provider-only probes can still use a provider-scoped maintenance process.
    process: {
      command: opts?.processCommand ?? "codex",
      args: opts?.processArgs ?? ["app-server"],
    },
    initializeParams: {
      clientInfo: { name: "bb", version: "1.0.0", title: null },
      capabilities: { experimentalApi: true },
    },
    codec: "native",
    buildProviderCommandPlan(command) {
      switch (command.type) {
        case "model/list":
          return {
            kind: "request",
            method: "model/list",
            params: {},
          };
        case "skills/configure": {
          const params: CodexSkillsExtraRootsSetParams = {
            extraRoots: command.skillRoots.map((skillRoot) =>
              codexSkillRootPath({ skillRoot }),
            ),
          };
          return {
            kind: "request",
            method: "skills/extraRoots/set",
            params,
          };
        }
        case "thread/start": {
          const dynamicTools = toCodexDynamicTools(command.dynamicTools);
          const preparedGitRoots = prepareWorkspaceWriteGitRoots({ command });
          const params: BbThreadStartParams = {
            approvalPolicy: preparedGitRoots.permissionSettings.approvalPolicy,
            approvalsReviewer:
              preparedGitRoots.permissionSettings.approvalsReviewer,
            sandbox: preparedGitRoots.permissionSettings.sandbox,
            cwd: command.cwd,
            ...resolveCodexInstructionOverrides(command),
            model: command.options?.model ?? undefined,
            serviceTier: toCodexServiceTier(command.options?.serviceTier),
            // bb reaps idle thread-scoped Codex processes and later resumes by
            // provider thread id, so the rollout must exist on disk. Codex
            // already defaults to non-ephemeral; pin the value so a future
            // default flip cannot silently break resume.
            ephemeral: false,
            config: preparedGitRoots.config ?? undefined,
            // Codex only exposes raw Responses items as a thread/start opt-in.
            experimentalRawEvents: true,
            ...(dynamicTools && dynamicTools.length > 0
              ? { dynamicTools }
              : {}),
          };
          return {
            kind: "request",
            method: "thread/start",
            params,
          };
        }
        case "thread/resume": {
          const dynamicTools = toCodexDynamicTools(command.dynamicTools);
          const preparedGitRoots = prepareWorkspaceWriteGitRoots({ command });
          const params: ThreadResumeParams = {
            threadId: command.providerThreadId,
            approvalPolicy: preparedGitRoots.permissionSettings.approvalPolicy,
            approvalsReviewer:
              preparedGitRoots.permissionSettings.approvalsReviewer,
            sandbox: preparedGitRoots.permissionSettings.sandbox,
            cwd: command.cwd,
            ...resolveCodexInstructionOverrides(command),
            model: command.options?.model ?? undefined,
            serviceTier: toCodexServiceTier(command.options?.serviceTier),
            config: preparedGitRoots.config ?? undefined,
            ...(dynamicTools && dynamicTools.length > 0
              ? { dynamicTools }
              : {}),
          };
          return {
            kind: "request",
            method: "thread/resume",
            params,
          };
        }
        case "thread/fork": {
          const dynamicTools = toCodexDynamicTools(command.dynamicTools);
          const preparedGitRoots = prepareWorkspaceWriteGitRoots({ command });
          const params: BbThreadForkParams = {
            threadId: command.sourceProviderThreadId,
            ...(command.sourceProviderCheckpointId !== undefined
              ? { lastTurnId: command.sourceProviderCheckpointId }
              : {}),
            approvalPolicy: preparedGitRoots.permissionSettings.approvalPolicy,
            approvalsReviewer:
              preparedGitRoots.permissionSettings.approvalsReviewer,
            sandbox: preparedGitRoots.permissionSettings.sandbox,
            cwd: command.cwd,
            ...resolveCodexInstructionOverrides(command),
            model: command.options?.model ?? undefined,
            serviceTier: toCodexServiceTier(command.options?.serviceTier),
            config: preparedGitRoots.config ?? undefined,
            ...(dynamicTools && dynamicTools.length > 0
              ? { dynamicTools }
              : {}),
          };
          return {
            kind: "request",
            method: "thread/fork",
            params,
          };
        }
        case "turn/start": {
          const input = flattenPromptInputGroups(
            command.input,
            command.inputGroups,
          );
          if (isStandaloneBuiltinCompactCommand(input)) {
            const params: ThreadCompactStartParams = {
              threadId: command.providerThreadId,
            };
            return {
              kind: "request",
              method: "thread/compact/start",
              params,
            };
          }
          const writableRoots =
            workspaceWriteGitWritableRootsByThreadId.get(command.threadId) ??
            [];
          const permissionSettings = toCodexPermissionSettings({
            additionalWorkspaceWriteRoots,
            gitWritableRoots: writableRoots,
            options: command.options,
          });
          return {
            kind: "request",
            method: "turn/start",
            params: {
              threadId: command.providerThreadId,
              input: toCodexUserInput(input),
              approvalPolicy: permissionSettings.approvalPolicy,
              approvalsReviewer: permissionSettings.approvalsReviewer,
              sandboxPolicy: permissionSettings.sandboxPolicy,
              model: command.options?.model ?? undefined,
              serviceTier: toCodexServiceTier(command.options?.serviceTier),
            },
          };
        }
        case "turn/steer":
          return {
            kind: "request",
            method: "turn/steer",
            params: {
              threadId: command.providerThreadId,
              expectedTurnId: command.expectedTurnId,
              input: toCodexUserInput(
                flattenPromptInputGroups(command.input, command.inputGroups),
              ),
            },
          };
        case "thread/name/set":
          if (!capabilities.supportsRename) {
            return { kind: "noop", reason: "rename unsupported" };
          }
          return {
            kind: "request",
            method: "thread/name/set",
            params: {
              threadId: command.providerThreadId,
              name: command.title,
            },
          };
        case "thread/archive":
          if (!capabilities.supportsArchive) {
            return { kind: "noop", reason: "archive unsupported" };
          }
          return {
            kind: "request",
            method: "thread/archive",
            params: {
              threadId: command.providerThreadId,
            },
          };
        case "thread/unarchive":
          if (!capabilities.supportsArchive) {
            return { kind: "noop", reason: "archive unsupported" };
          }
          return {
            kind: "request",
            method: "thread/unarchive",
            params: {
              threadId: command.providerThreadId,
            },
          };
        case "thread/stop":
          if (command.activeTurnId === null) {
            return { kind: "noop", reason: "no active turn to interrupt" };
          }
          return {
            kind: "request",
            method: "turn/interrupt",
            params: {
              threadId: command.providerThreadId,
              turnId: command.activeTurnId,
            },
          };
        case "thread/discard":
          if (!capabilities.supportsArchive) {
            return { kind: "noop", reason: "archive unsupported" };
          }
          return {
            kind: "request",
            method: "thread/archive",
            params: { threadId: command.providerThreadId },
          };
        case "thread/goal/clear":
          return {
            kind: "request",
            method: "thread/goal/clear",
            params: { threadId: command.providerThreadId },
          };
      }
    },

    prepareTurnStart(command) {
      return queueNativeTurnStartClientRequestId({
        clientRequestId: command.clientRequestId,
        providerThreadId: command.providerThreadId,
      });
    },

    translateEvent(event: ProviderRuntimeEvent) {
      clearClosedThreadState(event);
      const rawResponseEvents = consumeCodexRawResponseItem(event);
      if (rawResponseEvents !== null) {
        return rawResponseEvents;
      }

      const subAgentActivityEvents = translateCodexSubAgentActivity(event);
      if (subAgentActivityEvents !== null) {
        return reconcileRawCommandOutputLifecycle(
          applyRecoveredCommandOutput(subAgentActivityEvents),
        );
      }

      const parentLinkedEvents = attachCodexDelegationParentLinks(
        translateCodexEvent(event, eventTranslationState),
      );
      const translatedEvents = parentLinkedEvents.flatMap(
        attachAcceptedUserMessageCorrelation,
      );
      const completedSubAgentEvents =
        completeFinishedCodexSubAgentTurns(translatedEvents);
      return reconcileRawCommandOutputLifecycle(
        applyRecoveredCommandOutput(completedSubAgentEvents),
      );
    },

    onSessionReplace({ command, providerThreadId }) {
      if (providerThreadId) {
        activateThreadGitWritableRoots({
          providerThreadId,
          threadId: command.threadId,
        });
      }
      return [];
    },

    parseModelListResult(result: unknown) {
      // Codex's upstream API only exposes an active model list; legacy/retired
      // models aren't surfaced separately, so selectedOnlyModels is always empty.
      return {
        models: parseModelsResponse(result),
        selectedOnlyModels: [],
      };
    },
  });

  return {
    ...standardAdapterMembers,
    // Codex reports native subagents as toolCall items rather than as BB
    // background tasks, so the shared background-work state cannot see them.
    // Report them here; a session release must not stop the parent process
    // while a child agent still runs or still owes a followup turn.
    hasOpenThreadWork({ providerThreadId }: { providerThreadId: string }) {
      for (const tracked of trackedSubAgentsByCallId.values()) {
        if (tracked.parentProviderThreadId !== providerThreadId) {
          continue;
        }
        if (!tracked.terminal || tracked.pendingFollowups > 0) {
          return true;
        }
      }
      return false;
    },
    buildPostInitializeRequests,
    decodeInteractiveRequest(request: ProviderInboundRequest) {
      return decodeCodexInteractiveRequest(request);
    },
    buildInteractiveResponse(args) {
      return buildCodexInteractiveResponse(args);
    },
  };
}
