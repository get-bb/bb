import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentRuntime,
  AgentRuntimeBridgeLaunch,
  AgentRuntimeExecutionOptions,
  AgentRuntimeProviderSession,
} from "@bb/agent-runtime";
import type {
  ClientTurnRequestId,
  AvailableModel,
  DynamicTool,
  GitHostPullRequest,
  PromptInput,
} from "@bb/domain";
import type {
  HostDaemonAcpLaunchSpec,
  HostDaemonBridgeLaunch,
} from "@bb/host-daemon-contract";
import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "@bb/test-helpers";
import type {
  HostWorkspace,
  ProvisionWorkspaceArgs,
  PullRequestActionOptions,
} from "@bb/host-workspace";
import { RuntimeManager } from "../../src/runtime-manager.js";
import { listFilesRecursively } from "../../src/command-handlers/file-list.js";
import { noopEventSink } from "../../src/command-dispatch-support.js";
import type { CommandDispatchOptions } from "../../src/command-dispatch-support.js";
import type { FetchProjectAttachment } from "../../src/project-attachments.js";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);
/** Dispatch's diagnostic logger; tests that assert on logs pass their own. */
export const silentLogger: CommandDispatchOptions["logger"] = {
  debug: () => undefined,
  warn: () => undefined,
};

export const unexpectedProjectAttachmentFetch: FetchProjectAttachment =
  async () => {
    throw new Error("Unexpected project attachment fetch");
  };

type GitCommandArgs = string[];

interface RunGitCommandOptions {
  cwd: string;
}

type FakeWorkspaceDiffTarget =
  | { type: "uncommitted" }
  | { type: "branch_committed"; mergeBaseBranch: string }
  | { type: "all"; mergeBaseBranch: string }
  | { type: "commit"; sha: string };

interface FakeWorkspaceState {
  destroyed: boolean;
  lastCommitMessage: string | undefined;
  lastDiffTarget: FakeWorkspaceDiffTarget | undefined;
  lastPullRequestAction: PullRequestActionOptions | undefined;
  listedModelsProviderId: string | undefined;
  listedModelsAcpLaunchSpec: HostDaemonAcpLaunchSpec | undefined;
  pullRequest: GitHostPullRequest | null;
  pullRequestLookupError: string | null;
  resetCount: number;
  statusReads: number;
}

/**
 * Direct mutators for the fake runtime's thread state, replacing what the
 * deleted RuntimeManager thread bookkeeping used to provide in tests.
 */
export interface FakeRuntimeThreadControls {
  clearProviderSession: (threadId: string) => void;
  endActiveTurn: (threadId: string) => void;
  setActiveTurn: (threadId: string, turnId: string) => void;
  setProviderSession: (
    threadId: string,
    session: AgentRuntimeProviderSession,
  ) => void;
}

interface FakeRuntimeState {
  archivedBridgeLaunch: AgentRuntimeBridgeLaunch | undefined;
  archivedProviderId: string | undefined;
  archivedProviderThreadId: string | undefined;
  archivedThreadId: string | undefined;
  listedModelsProviderId: string | undefined;
  listedModelsAcpLaunchSpec: HostDaemonAcpLaunchSpec | undefined;
  ranTurnClientRequestId: ClientTurnRequestId | undefined;
  ranTurnInput: PromptInput[] | undefined;
  ranTurnInputGroups: PromptInput[][] | undefined;
  ranTurnInstructions: string | undefined;
  ranTurnOptions: AgentRuntimeExecutionOptions | undefined;
  ranTurnText: string | undefined;
  renamedTitle: string | undefined;
  resumedDynamicTools: DynamicTool[] | undefined;
  resumedAcpLaunchSpec: HostDaemonAcpLaunchSpec | undefined;
  resumedBridgeLaunch: AgentRuntimeBridgeLaunch | undefined;
  resumedEnvironmentId: string | undefined;
  resumedInstructions: string | undefined;
  resumedOptions: AgentRuntimeExecutionOptions | undefined;
  resumedProviderThreadId: string | undefined;
  resumedThreadId: string | undefined;
  runningProviders: string[];
  shutdownCount: number;
  startedDynamicTools: DynamicTool[] | undefined;
  startedAcpLaunchSpec: HostDaemonAcpLaunchSpec | undefined;
  startedBridgeLaunch: AgentRuntimeBridgeLaunch | undefined;
  startedEnvironmentId: string | undefined;
  startedInput: PromptInput[] | undefined;
  startedInputGroups: PromptInput[][] | undefined;
  startedInstructions: string | undefined;
  startedOptions: AgentRuntimeExecutionOptions | undefined;
  startedThreadId: string | undefined;
  steeredClientRequestId: ClientTurnRequestId | undefined;
  steeredInput: PromptInput[] | undefined;
  steeredInputGroups: PromptInput[][] | undefined;
  steeredTurnId: string | undefined;
  steeredTurnInstructions: string | undefined;
  steeredTurnOptions: AgentRuntimeExecutionOptions | undefined;
  stoppedThreadId: string | undefined;
  unarchivedBridgeLaunch: AgentRuntimeBridgeLaunch | undefined;
  unarchivedProviderId: string | undefined;
  unarchivedProviderThreadId: string | undefined;
  unarchivedThreadId: string | undefined;
}

// Tests reassign workspace fields (e.g. isWorktree, getCurrentBranch) on the
// fake to vary behavior per test, so the fake exposes mutable equivalents of
// HostWorkspace's otherwise-readonly fields.
type FakeHostWorkspace = {
  -readonly [K in keyof HostWorkspace]: HostWorkspace[K];
};

export function createFakeWorkspace(pathname: string) {
  const state: FakeWorkspaceState = {
    statusReads: 0,
    lastDiffTarget: undefined,
    lastCommitMessage: undefined,
    resetCount: 0,
    destroyed: false,
    listedModelsProviderId: undefined,
    listedModelsAcpLaunchSpec: undefined,
    lastPullRequestAction: undefined,
    pullRequest: null,
    pullRequestLookupError: null,
  };
  const workspace: FakeHostWorkspace = {
    path: pathname,
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    async getDefaultBranch() {
      return "main";
    },
    async getCurrentBranch() {
      return "main";
    },
    async getHeadSha() {
      return "commit-1";
    },
    async getLocalStateFingerprint() {
      return JSON.stringify({
        currentBranch: "main",
        headSha: "commit-1",
        workingTree: {
          hasUncommittedChanges: false,
          state: "clean",
          insertions: 0,
          deletions: 0,
          files: [],
        },
      });
    },
    async getSharedGitRefsFingerprint() {
      return JSON.stringify({
        refs: ["refs/heads/main\u0000commit-1"],
        remoteHead: "refs/remotes/origin/main",
      });
    },
    async getAdditionalWorkspaceWriteRoots() {
      return [];
    },
    async getStatus(options?: { mergeBaseBranch?: string }) {
      state.statusReads += 1;
      return makeWorkspaceStatus({
        mergeBase: options?.mergeBaseBranch
          ? makeWorkspaceMergeBase({
              mergeBaseBranch: options.mergeBaseBranch,
              baseRef: options.mergeBaseBranch,
            })
          : null,
      });
    },
    async getDiff(options?: {
      target?:
        | { type: "uncommitted" }
        | { type: "branch_committed"; mergeBaseBranch: string }
        | { type: "all"; mergeBaseBranch: string }
        | { type: "commit"; sha: string };
    }) {
      state.lastDiffTarget = options?.target;
      return {
        diff: "",
        truncated: false,
        shortstat: "",
        files: "",
        mergeBaseRef: null,
      };
    },
    async diffFiles() {
      return {
        files: [],
        shortstat: "",
        mergeBaseRef: null,
        truncated: false,
      };
    },
    async diffPatch() {
      return [];
    },
    async getPullRequest() {
      if (state.pullRequestLookupError !== null) {
        return {
          outcome: "unavailable" as const,
          message: state.pullRequestLookupError,
        };
      }
      return state.pullRequest === null
        ? { outcome: "none" as const }
        : { outcome: "found" as const, pullRequest: state.pullRequest };
    },
    async runPullRequestAction(action) {
      state.lastPullRequestAction = action;
    },
    async listBranches() {
      return ["main"];
    },
    async listFiles() {
      return listFilesRecursively(pathname, pathname);
    },
    async commit(options: { message: string; noVerify: boolean }) {
      state.lastCommitMessage = options.message;
      return {
        commitSha: "commit-1",
        commitSubject: options.message,
      };
    },
    async reset() {
      state.resetCount += 1;
    },
    async fetch() {},
    async squashMerge(options: {
      targetBranch: string;
      commitMessage: string;
    }) {
      return {
        merged: true,
        commitSha: `merge-${options.targetBranch}`,
        commitSubject: options.commitMessage,
        targetBranch: options.targetBranch,
      };
    },
    async destroy() {
      state.destroyed = true;
    },
  };

  return { workspace, state };
}

export function createFakeRuntime() {
  const state: FakeRuntimeState = {
    archivedBridgeLaunch: undefined,
    archivedProviderId: undefined,
    archivedProviderThreadId: undefined,
    archivedThreadId: undefined,
    listedModelsProviderId: undefined,
    listedModelsAcpLaunchSpec: undefined,
    ranTurnClientRequestId: undefined,
    ranTurnInput: undefined,
    ranTurnInputGroups: undefined,
    ranTurnInstructions: undefined,
    ranTurnOptions: undefined,
    ranTurnText: undefined,
    renamedTitle: undefined,
    resumedDynamicTools: undefined,
    resumedAcpLaunchSpec: undefined,
    resumedBridgeLaunch: undefined,
    resumedEnvironmentId: undefined,
    resumedInstructions: undefined,
    resumedOptions: undefined,
    resumedProviderThreadId: undefined,
    resumedThreadId: undefined,
    runningProviders: [],
    shutdownCount: 0,
    startedDynamicTools: undefined,
    startedAcpLaunchSpec: undefined,
    startedBridgeLaunch: undefined,
    startedEnvironmentId: undefined,
    startedInput: undefined,
    startedInputGroups: undefined,
    startedInstructions: undefined,
    startedOptions: undefined,
    startedThreadId: undefined,
    steeredClientRequestId: undefined,
    steeredInput: undefined,
    steeredInputGroups: undefined,
    steeredTurnId: undefined,
    steeredTurnInstructions: undefined,
    steeredTurnOptions: undefined,
    stoppedThreadId: undefined,
    unarchivedBridgeLaunch: undefined,
    unarchivedProviderId: undefined,
    unarchivedProviderThreadId: undefined,
    unarchivedThreadId: undefined,
  };
  const activeTurnsByThreadId = new Map<string, string>();
  const providerSessionsByThreadId = new Map<
    string,
    AgentRuntimeProviderSession
  >();
  let nextTurnNumber = 1;
  const threadControls: FakeRuntimeThreadControls = {
    clearProviderSession(threadId) {
      providerSessionsByThreadId.delete(threadId);
    },
    endActiveTurn(threadId) {
      activeTurnsByThreadId.delete(threadId);
    },
    setActiveTurn(threadId, turnId) {
      // An active turn implies a hosted thread, mirroring the real runtime
      // where turn/started can only be observed for a registered thread.
      if (!providerSessionsByThreadId.has(threadId)) {
        providerSessionsByThreadId.set(threadId, {
          providerId: "fake",
          providerThreadId: `provider-${threadId}`,
        });
      }
      activeTurnsByThreadId.set(threadId, turnId);
    },
    setProviderSession(threadId, session) {
      providerSessionsByThreadId.set(threadId, session);
    },
  };
  const runtime: AgentRuntime = {
    async ensureProvider() {},
    async startThread(args) {
      state.startedAcpLaunchSpec = args.acpLaunchSpec;
      state.startedBridgeLaunch = args.bridgeLaunch;
      state.startedEnvironmentId = args.environmentId;
      state.startedThreadId = args.threadId;
      state.startedDynamicTools = args.dynamicTools;
      state.startedInput = args.input;
      state.startedInputGroups = args.inputGroups;
      state.startedOptions = args.options;
      state.startedInstructions = args.instructions;
      providerSessionsByThreadId.set(args.threadId, {
        providerId: args.providerId,
        providerThreadId: `provider-${args.threadId}`,
      });
      if (args.input && args.input.length > 0) {
        activeTurnsByThreadId.set(args.threadId, `turn-${nextTurnNumber++}`);
      }
      return { providerThreadId: `provider-${args.threadId}` };
    },
    async prepareThreadRewind(args) {
      return {
        providerThreadId: `provider-rewind-${args.threadId}-${args.leaseId}`,
      };
    },
    async discardThreadRewind() {},
    async resumeThread(args) {
      state.resumedAcpLaunchSpec = args.acpLaunchSpec;
      state.resumedBridgeLaunch = args.bridgeLaunch;
      state.resumedEnvironmentId = args.environmentId;
      state.resumedThreadId = args.threadId;
      state.resumedDynamicTools = args.dynamicTools;
      state.resumedOptions = args.options;
      state.resumedInstructions = args.instructions;
      state.resumedProviderThreadId = args.providerThreadId;
      const providerThreadId =
        args.providerThreadId ?? `provider-${args.threadId}`;
      providerSessionsByThreadId.set(args.threadId, {
        providerId: args.providerId,
        providerThreadId,
      });
      return { providerThreadId };
    },
    async runTurn(args) {
      const firstInput = args.input[0];
      state.ranTurnText =
        firstInput?.type === "text" ? firstInput.text : undefined;
      state.ranTurnClientRequestId = args.clientRequestId;
      state.ranTurnInput = args.input;
      state.ranTurnInputGroups = args.inputGroups;
      state.ranTurnOptions = args.options;
      state.ranTurnInstructions = args.instructions;
      activeTurnsByThreadId.set(args.threadId, `turn-${nextTurnNumber++}`);
    },
    async steerTurn(args) {
      state.steeredTurnId = args.expectedTurnId;
      state.steeredClientRequestId = args.clientRequestId;
      state.steeredInput = args.input;
      state.steeredInputGroups = args.inputGroups;
      state.steeredTurnOptions = args.options;
      state.steeredTurnInstructions = args.instructions;
      return { status: "steered" };
    },
    async stopThread(args) {
      state.stoppedThreadId = args.threadId;
      activeTurnsByThreadId.delete(args.threadId);
      providerSessionsByThreadId.delete(args.threadId);
      return { providerCheckpointId: null };
    },
    async clearThreadGoal() {
      return { cleared: true };
    },
    async renameThread(args) {
      state.renamedTitle = args.title;
    },
    async archiveThread(args) {
      state.archivedThreadId = args.threadId;
      state.archivedProviderId = args.providerId;
      state.archivedProviderThreadId = args.providerThreadId;
      state.archivedBridgeLaunch = args.bridgeLaunch;
      activeTurnsByThreadId.delete(args.threadId);
      providerSessionsByThreadId.delete(args.threadId);
    },
    async unarchiveThread(args) {
      state.unarchivedThreadId = args.threadId;
      state.unarchivedProviderId = args.providerId;
      state.unarchivedProviderThreadId = args.providerThreadId;
      state.unarchivedBridgeLaunch = args.bridgeLaunch;
    },
    listRunningProviders() {
      return state.runningProviders;
    },
    getActiveTurnId(threadId) {
      return activeTurnsByThreadId.get(threadId) ?? null;
    },
    async waitForActiveTurn(threadId) {
      // The fake resolves immediately with the current state; waiting
      // semantics are covered by the real runtime's tests.
      return activeTurnsByThreadId.get(threadId) ?? null;
    },
    getProviderSession(threadId) {
      return providerSessionsByThreadId.get(threadId) ?? null;
    },
    async reapIdleProviderSessions() {
      return { reapedSessions: [] };
    },
    hasThread(threadId) {
      return providerSessionsByThreadId.has(threadId);
    },
    getLiveThreadIds() {
      return [...activeTurnsByThreadId.keys()];
    },
    hasOpenBackgroundWork() {
      return false;
    },
    async listModels(args) {
      state.listedModelsProviderId = args.providerId;
      state.listedModelsAcpLaunchSpec = args.acpLaunchSpec;
      return {
        models: [] satisfies AvailableModel[],
        selectedOnlyModels: [] satisfies AvailableModel[],
      };
    },
    async shutdown() {
      state.shutdownCount += 1;
    },
  };

  return {
    runtime,
    state,
    threadControls,
  };
}

export function createHarness(
  args: {
    workspacePath?: string;
    currentBranch?: string;
    isWorktree?: boolean;
  } = {},
) {
  const { workspace, state: workspaceState } = createFakeWorkspace(
    args.workspacePath ?? "/tmp/env-1",
  );
  workspace.getCurrentBranch = async () => args.currentBranch ?? "main";
  workspace.isWorktree = args.isWorktree ?? false;
  let provisionedWorkspace: HostWorkspace = workspace;
  const { runtime, state: runtimeState, threadControls } = createFakeRuntime();
  const provisions: ProvisionWorkspaceArgs[] = [];
  const manager = new RuntimeManager({
    provisionWorkspace: async (options) => {
      provisions.push(options);
      if ("path" in options && options.path !== workspace.path) {
        return createFakeWorkspace(options.path).workspace;
      }
      return provisionedWorkspace;
    },
    createRuntime: () => runtime,
  });

  return {
    manager,
    provisions,
    runtime,
    runtimeState,
    threadControls,
    workspaceState,
    workspace,
    setProvisionedWorkspace(nextWorkspace: HostWorkspace): void {
      provisionedWorkspace = nextWorkspace;
    },
    /** Default dispatch options with threadStorageRootPath for tests. */
    dispatchOptions(
      overrides: { dataDir?: string; threadStorageRootPath?: string } = {},
    ): CommandDispatchOptions {
      return {
        dataDir: overrides.dataDir ?? "/tmp/bb-test-data",
        logger: silentLogger,
        eventSink: noopEventSink,
        fetchProjectAttachment: unexpectedProjectAttachmentFetch,
        runtimeManager: manager,
        threadStorageRootPath:
          overrides.threadStorageRootPath ?? "/tmp/bb-test-thread-storage",
      };
    },
  };
}

/** Build a complete CommandDispatchOptions using an already-created RuntimeManager. */
export function makeDispatchOptions(
  overrides: Partial<CommandDispatchOptions> &
    Pick<CommandDispatchOptions, "runtimeManager">,
): CommandDispatchOptions {
  return {
    dataDir: "/tmp/bb-test-data",
    logger: silentLogger,
    eventSink: noopEventSink,
    fetchProjectAttachment: unexpectedProjectAttachmentFetch,
    threadStorageRootPath: "/tmp/bb-test-thread-storage",
    ...overrides,
  };
}

export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export async function runGitCommand(
  args: GitCommandArgs,
  options: RunGitCommandOptions,
): Promise<void> {
  await execFileAsync("git", args, { cwd: options.cwd });
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
}

/**
 * Every bridge-bound command now carries a `bridgeLaunch`. These tests
 * exercise dispatch and runtime plumbing rather than bridge delivery, so they
 * name the daemon's own bundled Pi bridge — no artifact fetch — with
 * permissive capabilities, so no capability gate trips by accident.
 */
export const DISPATCH_TEST_BRIDGE_LAUNCH: HostDaemonBridgeLaunch = {
  pluginId: "provider-pi",
  source: { kind: "daemon-bundled", id: "pi" },
  capabilities: {
    supportsServiceTier: true,
    permissionModes: ["accept-edits", "auto", "full"],
    supportsThreadArchive: true,
    supportsThreadRename: true,
    fork: "checkpoint",
  },
};

/**
 * The same launch after {@link resolveRuntimeBridgeLaunch}, for tests that call
 * runtime entry points directly: a daemon-bundled source needs no fetch, but
 * the resolved shape additionally carries the plugin-scoped directory the
 * bridge bootstrap hands its bridge.
 */
export const DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH: AgentRuntimeBridgeLaunch = {
  pluginId: "provider-pi",
  // Where `resolveRuntimeBridgeLaunch` puts a bridge's plugin-scoped
  // directory under the helpers' own data dir.
  dataDir: "/tmp/bb-test-data/plugins/provider-pi/bridge-data",
  source: { kind: "daemon-bundled", id: "pi" },
  capabilities: DISPATCH_TEST_BRIDGE_LAUNCH.capabilities,
};
