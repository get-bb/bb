import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentRuntime,
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
import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "@bb/test-helpers";
import type { HostWorkspace, ProvisionWorkspaceArgs } from "@bb/host-workspace";
import { RuntimeManager } from "../../src/runtime-manager.js";
import { listFilesRecursively } from "../../src/command-handlers/file-list.js";
import { noopEventSink } from "../../src/command-dispatch-support.js";
import type { CommandDispatchOptions } from "../../src/command-dispatch-support.js";
import type { FetchProjectAttachment } from "../../src/project-attachments.js";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);
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
  listedModelsProviderId: string | undefined;
  pullRequest: GitHostPullRequest | null;
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
  archivedProviderId: string | undefined;
  archivedProviderThreadId: string | undefined;
  archivedThreadId: string | undefined;
  listedModelsProviderId: string | undefined;
  ranTurnClientRequestId: ClientTurnRequestId | undefined;
  ranTurnInput: PromptInput[] | undefined;
  ranTurnInstructions: string | undefined;
  ranTurnOptions: AgentRuntimeExecutionOptions | undefined;
  ranTurnText: string | undefined;
  renamedTitle: string | undefined;
  resumedDynamicTools: DynamicTool[] | undefined;
  resumedEnvironmentId: string | undefined;
  resumedInstructions: string | undefined;
  resumedOptions: AgentRuntimeExecutionOptions | undefined;
  resumedProviderThreadId: string | undefined;
  resumedThreadId: string | undefined;
  runningProviders: string[];
  shutdownCount: number;
  startedDynamicTools: DynamicTool[] | undefined;
  startedEnvironmentId: string | undefined;
  startedInput: PromptInput[] | undefined;
  startedInstructions: string | undefined;
  startedOptions: AgentRuntimeExecutionOptions | undefined;
  startedThreadId: string | undefined;
  steeredClientRequestId: ClientTurnRequestId | undefined;
  steeredTurnId: string | undefined;
  steeredTurnInstructions: string | undefined;
  steeredTurnOptions: AgentRuntimeExecutionOptions | undefined;
  stoppedThreadId: string | undefined;
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
    pullRequest: null,
  };
  const workspace: FakeHostWorkspace = {
    path: pathname,
    managed: false,
    isGitRepo: true,
    isWorktree: false,
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
    async getPullRequest() {
      return state.pullRequest;
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
    archivedProviderId: undefined,
    archivedProviderThreadId: undefined,
    archivedThreadId: undefined,
    listedModelsProviderId: undefined,
    ranTurnClientRequestId: undefined,
    ranTurnInput: undefined,
    ranTurnInstructions: undefined,
    ranTurnOptions: undefined,
    ranTurnText: undefined,
    renamedTitle: undefined,
    resumedDynamicTools: undefined,
    resumedEnvironmentId: undefined,
    resumedInstructions: undefined,
    resumedOptions: undefined,
    resumedProviderThreadId: undefined,
    resumedThreadId: undefined,
    runningProviders: [],
    shutdownCount: 0,
    startedDynamicTools: undefined,
    startedEnvironmentId: undefined,
    startedInput: undefined,
    startedInstructions: undefined,
    startedOptions: undefined,
    startedThreadId: undefined,
    steeredClientRequestId: undefined,
    steeredTurnId: undefined,
    steeredTurnInstructions: undefined,
    steeredTurnOptions: undefined,
    stoppedThreadId: undefined,
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
      state.startedEnvironmentId = args.environmentId;
      state.startedThreadId = args.threadId;
      state.startedDynamicTools = args.dynamicTools;
      state.startedInput = args.input;
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
    async resumeThread(args) {
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
      state.ranTurnOptions = args.options;
      state.ranTurnInstructions = args.instructions;
      activeTurnsByThreadId.set(args.threadId, `turn-${nextTurnNumber++}`);
    },
    async steerTurn(args) {
      state.steeredTurnId = args.expectedTurnId;
      state.steeredClientRequestId = args.clientRequestId;
      state.steeredTurnOptions = args.options;
      state.steeredTurnInstructions = args.instructions;
      return { status: "steered" };
    },
    async stopThread(args) {
      state.stoppedThreadId = args.threadId;
      activeTurnsByThreadId.delete(args.threadId);
      providerSessionsByThreadId.delete(args.threadId);
    },
    async renameThread(args) {
      state.renamedTitle = args.title;
    },
    async archiveThread(args) {
      state.archivedThreadId = args.threadId;
      state.archivedProviderId = args.providerId;
      state.archivedProviderThreadId = args.providerThreadId;
      activeTurnsByThreadId.delete(args.threadId);
      providerSessionsByThreadId.delete(args.threadId);
    },
    async unarchiveThread(args) {
      state.unarchivedThreadId = args.threadId;
      state.unarchivedProviderId = args.providerId;
      state.unarchivedProviderThreadId = args.providerThreadId;
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
    getActiveThreadIds() {
      return [...activeTurnsByThreadId.keys()];
    },
    async listModels(args) {
      state.listedModelsProviderId = args.providerId;
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
  const {
    runtime,
    state: runtimeState,
    threadControls,
  } = createFakeRuntime();
  const provisions: ProvisionWorkspaceArgs[] = [];
  const manager = new RuntimeManager({
    provisionWorkspace: async (options) => {
      provisions.push(options);
      if ("path" in options && options.path !== workspace.path) {
        return createFakeWorkspace(options.path).workspace;
      }
      return workspace;
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
    /** Default dispatch options with threadStorageRootPath for tests. */
    dispatchOptions(
      overrides: { dataDir?: string; threadStorageRootPath?: string } = {},
    ): CommandDispatchOptions {
      return {
        dataDir: overrides.dataDir ?? "/tmp/bb-test-data",
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
