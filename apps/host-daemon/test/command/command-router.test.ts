import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRuntime } from "@bb/agent-runtime";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
} from "@bb/domain";
import type { HostDaemonCommandResultReportWithoutSession } from "@bb/host-daemon-contract";
import {
  WorkspaceError,
  type CommitOptions,
  type CommitResult,
  type HostWorkspace,
  type ProvisionWorkspaceArgs,
  type SquashMergeOptions,
  type SquashMergeResult,
} from "@bb/host-workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandRouter } from "../../src/command-router.js";
import { noopEventSink } from "../../src/command-dispatch-support.js";
import { RuntimeManager } from "../../src/runtime-manager.js";
import { unexpectedProjectAttachmentFetch } from "./dispatch-helpers.js";

const tempDirs: string[] = [];
let nextClientRequestIdValue = 1;

type StartThreadArgs = Parameters<AgentRuntime["startThread"]>[0];
type StartThreadResult = Awaited<ReturnType<AgentRuntime["startThread"]>>;
type ResumeThreadArgs = Parameters<AgentRuntime["resumeThread"]>[0];
type ResumeThreadResult = Awaited<ReturnType<AgentRuntime["resumeThread"]>>;
type RunTurnArgs = Parameters<AgentRuntime["runTurn"]>[0];
type SteerTurnArgs = Parameters<AgentRuntime["steerTurn"]>[0];
type SteerTurnResult = Awaited<ReturnType<AgentRuntime["steerTurn"]>>;
type StopThreadArgs = Parameters<AgentRuntime["stopThread"]>[0];
type RenameThreadArgs = Parameters<AgentRuntime["renameThread"]>[0];
type ArchiveThreadArgs = Parameters<AgentRuntime["archiveThread"]>[0];
type UnarchiveThreadArgs = Parameters<AgentRuntime["unarchiveThread"]>[0];
type EnsureProviderArgs = Parameters<AgentRuntime["ensureProvider"]>[0];
type ListModelsArgs = Parameters<AgentRuntime["listModels"]>[0];
type ListModelsResult = Awaited<ReturnType<AgentRuntime["listModels"]>>;
type GetDiffResult = Awaited<ReturnType<HostWorkspace["getDiff"]>>;

async function makeTempDir(prefix: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function nextClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

// HostWorkspace exposes its scalar fields as readonly. The fake workspace lets
// tests reassign them where useful, so use the mutable equivalents and type
// each method as a vitest mock with the production signature.
interface FakeWorkspace {
  path: HostWorkspace["path"];
  managed: HostWorkspace["managed"];
  isGitRepo: HostWorkspace["isGitRepo"];
  isWorktree: HostWorkspace["isWorktree"];
  getCurrentBranch: ReturnType<typeof vi.fn<HostWorkspace["getCurrentBranch"]>>;
  getHeadSha: ReturnType<typeof vi.fn<HostWorkspace["getHeadSha"]>>;
  getLocalStateFingerprint: ReturnType<
    typeof vi.fn<HostWorkspace["getLocalStateFingerprint"]>
  >;
  getSharedGitRefsFingerprint: ReturnType<
    typeof vi.fn<HostWorkspace["getSharedGitRefsFingerprint"]>
  >;
  getAdditionalWorkspaceWriteRoots: ReturnType<
    typeof vi.fn<HostWorkspace["getAdditionalWorkspaceWriteRoots"]>
  >;
  getStatus: ReturnType<typeof vi.fn<HostWorkspace["getStatus"]>>;
  getDiff: ReturnType<typeof vi.fn<HostWorkspace["getDiff"]>>;
  listBranches: ReturnType<typeof vi.fn<HostWorkspace["listBranches"]>>;
  listFiles: ReturnType<typeof vi.fn<HostWorkspace["listFiles"]>>;
  commit: ReturnType<
    typeof vi.fn<(options: CommitOptions) => Promise<CommitResult>>
  >;
  reset: ReturnType<typeof vi.fn<HostWorkspace["reset"]>>;
  fetch: ReturnType<typeof vi.fn<HostWorkspace["fetch"]>>;
  squashMerge: ReturnType<
    typeof vi.fn<(options: SquashMergeOptions) => Promise<SquashMergeResult>>
  >;
  destroy: ReturnType<typeof vi.fn<HostWorkspace["destroy"]>>;
}

function createFakeWorkspace(path: string): FakeWorkspace {
  return {
    path,
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    getCurrentBranch: vi.fn<HostWorkspace["getCurrentBranch"]>(
      async () => "main",
    ),
    getHeadSha: vi.fn<HostWorkspace["getHeadSha"]>(async () => "commit-1"),
    getLocalStateFingerprint: vi.fn<HostWorkspace["getLocalStateFingerprint"]>(
      async () =>
        JSON.stringify({ currentBranch: "main", headSha: "commit-1" }),
    ),
    getSharedGitRefsFingerprint: vi.fn<
      HostWorkspace["getSharedGitRefsFingerprint"]
    >(async () =>
      JSON.stringify({
        refs: [["refs/heads/main", "commit-1"]],
        remoteHead: null,
      }),
    ),
    getAdditionalWorkspaceWriteRoots: vi.fn<
      HostWorkspace["getAdditionalWorkspaceWriteRoots"]
    >(async () => []),
    getStatus: vi.fn<HostWorkspace["getStatus"]>(async () => ({
      workingTree: {
        hasUncommittedChanges: false,
        state: "clean",
        insertions: 0,
        deletions: 0,
        files: [],
      },
      branch: {
        currentBranch: "main",
        defaultBranch: "main",
      },
      mergeBase: null,
    })),
    getDiff: vi.fn<HostWorkspace["getDiff"]>(async () => ({
      diff: "",
      truncated: false,
      shortstat: "",
      files: "",
      mergeBaseRef: null,
    })),
    listBranches: vi.fn<HostWorkspace["listBranches"]>(async () => ["main"]),
    listFiles: vi.fn<HostWorkspace["listFiles"]>(async () => []),
    commit: vi.fn<(options: CommitOptions) => Promise<CommitResult>>(
      async () => ({
        commitSha: "commit-1",
        commitSubject: "subject",
      }),
    ),
    reset: vi.fn<HostWorkspace["reset"]>(async () => undefined),
    fetch: vi.fn<HostWorkspace["fetch"]>(async () => undefined),
    squashMerge: vi.fn<
      (options: SquashMergeOptions) => Promise<SquashMergeResult>
    >(async () => ({
      merged: true,
      commitSha: "commit-3",
      commitSubject: "squash subject",
      targetBranch: "main",
    })),
    destroy: vi.fn<HostWorkspace["destroy"]>(async () => undefined),
  };
}

interface FakeRuntime {
  ensureProvider: ReturnType<
    typeof vi.fn<(args: EnsureProviderArgs) => Promise<void>>
  >;
  startThread: ReturnType<
    typeof vi.fn<(args: StartThreadArgs) => Promise<StartThreadResult>>
  >;
  resumeThread: ReturnType<
    typeof vi.fn<(args: ResumeThreadArgs) => Promise<ResumeThreadResult>>
  >;
  runTurn: ReturnType<typeof vi.fn<(args: RunTurnArgs) => Promise<void>>>;
  steerTurn: ReturnType<
    typeof vi.fn<(args: SteerTurnArgs) => Promise<SteerTurnResult>>
  >;
  stopThread: ReturnType<typeof vi.fn<(args: StopThreadArgs) => Promise<void>>>;
  renameThread: ReturnType<
    typeof vi.fn<(args: RenameThreadArgs) => Promise<void>>
  >;
  archiveThread: ReturnType<
    typeof vi.fn<(args: ArchiveThreadArgs) => Promise<void>>
  >;
  unarchiveThread: ReturnType<
    typeof vi.fn<(args: UnarchiveThreadArgs) => Promise<void>>
  >;
  listModels: ReturnType<
    typeof vi.fn<(args: ListModelsArgs) => Promise<ListModelsResult>>
  >;
  listRunningProviders: ReturnType<typeof vi.fn<() => string[]>>;
  shutdown: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function createFakeRuntime(): FakeRuntime {
  return {
    ensureProvider: vi.fn<(args: EnsureProviderArgs) => Promise<void>>(
      async () => undefined,
    ),
    startThread: vi.fn<(args: StartThreadArgs) => Promise<StartThreadResult>>(
      async ({ threadId }) => ({
        providerThreadId: `provider-${threadId}`,
      }),
    ),
    resumeThread: vi.fn<
      (args: ResumeThreadArgs) => Promise<ResumeThreadResult>
    >(async ({ providerThreadId }) => ({
      providerThreadId: providerThreadId ?? "provider-resumed",
    })),
    runTurn: vi.fn<(args: RunTurnArgs) => Promise<void>>(async () => undefined),
    steerTurn: vi.fn<(args: SteerTurnArgs) => Promise<SteerTurnResult>>(
      async () => ({ status: "steered" }),
    ),
    stopThread: vi.fn<(args: StopThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    renameThread: vi.fn<(args: RenameThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    archiveThread: vi.fn<(args: ArchiveThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    unarchiveThread: vi.fn<(args: UnarchiveThreadArgs) => Promise<void>>(
      async () => undefined,
    ),
    listModels: vi.fn<(args: ListModelsArgs) => Promise<ListModelsResult>>(
      async () => ({ models: [], selectedOnlyModels: [] }),
    ),
    listRunningProviders: vi.fn<() => string[]>(() => []),
    shutdown: vi.fn<() => Promise<void>>(async () => undefined),
  };
}

function createLogger() {
  return {
    warn: vi.fn(),
  };
}

function createStandardRuntimeCommandContext(args: {
  providerThreadId?: string;
  workspacePath: string;
}) {
  return {
    workspaceContext: {
      workspacePath: args.workspacePath,
      workspaceProvisionType: "unmanaged" as const,
    },
    projectId: "project-1",
    providerId: "fake",
    ...(args.providerThreadId
      ? { providerThreadId: args.providerThreadId }
      : {}),
    options: {
      model: "gpt-5",
      serviceTier: "default" as const,
      reasoningLevel: "medium" as const,
      workflowsEnabled: false,
      permissionMode: "full" as const,
      permissionEscalation: null,
    },
    instructions: "Be a helpful coding agent.",
    dynamicTools: [],
    injectedSkillSources: [],
    instructionMode: "append" as const,
  };
}

describe("CommandRouter", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((tempDir) => fs.rm(tempDir, { force: true, recursive: true })),
    );
  });

  it("does not flush unrelated buffered events before returning read-only workspace RPC results", async () => {
    const calls: string[] = [];
    const flushDeferred = createDeferred<void>();
    const eventSink = {
      emit: vi.fn(),
      flush: vi.fn(async () => {
        calls.push("flush");
        await flushDeferred.promise;
      }),
    };
    const reportResult = vi.fn(async () => {
      calls.push("report");
    });
    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
      workspaceProvisionType: "unmanaged",
    });
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: manager,
      eventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-status",
      command: {
        type: "workspace.status",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "workspace.status",
        ok: true,
        requestId: "rpc-status",
        type: "host-rpc.response",
      }),
    );
    expect(calls).toEqual([]);
    expect(eventSink.flush).not.toHaveBeenCalled();
    flushDeferred.resolve(undefined);
  });

  it("reports missing host file reads without warning", async () => {
    const rootPath = await makeTempDir("bb-command-router-read-file-");
    const missingPath = path.join(rootPath, "notes.md");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-read-missing-file",
      command: {
        type: "host.read_file",
        path: missingPath,
        rootPath,
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "host.read_file",
        errorCode: "ENOENT",
        errorMessage: `Path does not exist: ${missingPath}`,
        ok: false,
        requestId: "rpc-read-missing-file",
        type: "host-rpc.response",
      }),
    );
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing host file roots without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-read-file-root-");
    const rootPath = path.join(parentPath, "missing-root");
    const missingPath = path.join(rootPath, "notes.md");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-read-missing-root-file",
      command: {
        type: "host.read_file",
        path: missingPath,
        rootPath,
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "host.read_file",
        errorCode: "ENOENT",
        errorMessage: `Path does not exist: ${missingPath}`,
        ok: false,
        requestId: "rpc-read-missing-root-file",
        type: "host-rpc.response",
      }),
    );
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing host relative file reads without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-relative-file-");
    const rootPath = path.join(parentPath, "assets");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-read-missing-relative-index",
      command: {
        type: "host.read_file_relative",
        rootPath,
        path: "index.html",
        dotfiles: "deny",
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "host.read_file_relative",
        errorCode: "ENOENT",
        errorMessage: "Path does not exist: index.html",
        ok: false,
        requestId: "rpc-read-missing-relative-index",
        type: "host-rpc.response",
      }),
    );
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing workspace status paths without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-workspace-");
    const missingPath = path.join(parentPath, "missing-worktree");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => {
          throw new WorkspaceError(
            "path_not_found",
            `Managed workspace path does not exist: ${missingPath}`,
          );
        },
      }),
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-status-missing-workspace",
      command: {
        type: "workspace.status",
        environmentId: "env-missing",
        workspaceContext: {
          workspacePath: missingPath,
          workspaceProvisionType: "managed-worktree",
        },
        mergeBaseBranch: "main",
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "workspace.status",
        ok: true,
        requestId: "rpc-status-missing-workspace",
        result: {
          outcome: "unavailable",
          failure: {
            code: "path_not_found",
            workspacePath: missingPath,
            message: `Managed workspace path does not exist: ${missingPath}`,
          },
        },
        type: "host-rpc.response",
      }),
    );
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing workspace diff paths without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-workspace-diff-");
    const missingPath = path.join(parentPath, "missing-worktree");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => {
          throw new WorkspaceError(
            "path_not_found",
            `Managed workspace path does not exist: ${missingPath}`,
          );
        },
      }),
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-diff-missing-workspace",
      command: {
        type: "workspace.diff",
        environmentId: "env-missing",
        workspaceContext: {
          workspacePath: missingPath,
          workspaceProvisionType: "managed-worktree",
        },
        target: { type: "all", mergeBaseBranch: "main" },
        maxDiffBytes: 2 * 1024 * 1024,
        maxFileListBytes: 256 * 1024,
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "workspace.diff",
        ok: true,
        requestId: "rpc-diff-missing-workspace",
        result: {
          outcome: "unavailable",
          failure: {
            code: "path_not_found",
            workspacePath: missingPath,
            message: `Managed workspace path does not exist: ${missingPath}`,
          },
        },
        type: "host-rpc.response",
      }),
    );
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing provision paths without warning", async () => {
    const parentPath = await makeTempDir("bb-command-router-provision-");
    const missingPath = path.join(parentPath, "missing-workspace");
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => {
          throw new WorkspaceError(
            "path_not_found",
            `Unmanaged workspace path does not exist: ${missingPath}`,
          );
        },
      }),
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    await router.handleCommands([
      {
        id: "provision-missing-workspace",
        attemptId: "attempt-provision-missing-workspace",
        cursor: 1,
        command: {
          type: "environment.provision",
          environmentId: "env-missing-provision",
          initiator: null,
          workspaceProvisionType: "unmanaged",
          path: missingPath,
        },
      },
    ]);

    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "provision-missing-workspace",
        errorCode: "path_not_found",
        errorMessage: `Unmanaged workspace path does not exist: ${missingPath}`,
        ok: false,
        type: "environment.provision",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reports missing provider executables with a specific error code", async () => {
    const errorMessage =
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /missing/codex ENOENT';
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
      eventSink: noopEventSink,
      listModels: vi.fn(async () => {
        throw new Error(errorMessage);
      }),
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-provider-models-missing-executable",
      command: {
        type: "provider.list_models",
        providerId: "codex",
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "provider.list_models",
        errorCode: "missing_executable",
        errorMessage,
        ok: false,
        requestId: "rpc-provider-models-missing-executable",
        type: "host-rpc.response",
      }),
    );
    expect(reportResult).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        type: "provider.list_models",
      }),
      "online host RPC failed",
    );
  });

  it("preserves structured provider error codes over missing executable message fallback", async () => {
    class StructuredProviderError extends Error {
      readonly code = "permission_denied";
    }

    const errorMessage =
      'Provider "codex" exited unexpectedly\nstderr: Error: spawn /missing/codex ENOENT';
    const reportResult = vi.fn(async () => undefined);
    const logger = createLogger();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
      eventSink: noopEventSink,
      listModels: vi.fn(async () => {
        throw new StructuredProviderError(errorMessage);
      }),
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-provider-models-structured-error",
      command: {
        type: "provider.list_models",
        providerId: "codex",
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "provider.list_models",
        errorCode: "permission_denied",
        errorMessage,
        ok: false,
        requestId: "rpc-provider-models-structured-error",
        type: "host-rpc.response",
      }),
    );
    expect(reportResult).not.toHaveBeenCalled();
  });

  it("handles provider model online RPC without durable result reporting", async () => {
    const reportResult = vi.fn(async () => undefined);
    const listModels = vi.fn<
      (args: ListModelsArgs) => Promise<ListModelsResult>
    >(async () => ({
      models: [
        {
          id: "codex-mini",
          model: "gpt-4o-mini",
          displayName: "Codex Mini",
          description: "Fast codex model",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description: "Balanced",
            },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
    }));
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
      eventSink: noopEventSink,
      listModels,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });

    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-provider-models",
      command: {
        type: "provider.list_models",
        providerId: "codex",
      },
    });

    expect(response).toEqual({
      type: "host-rpc.response",
      requestId: "rpc-provider-models",
      commandType: "provider.list_models",
      ok: true,
      result: {
        models: [
          expect.objectContaining({
            id: "codex-mini",
          }),
        ],
        selectedOnlyModels: [],
      },
    });
    expect(listModels).toHaveBeenCalledWith({ providerId: "codex" });
    expect(reportResult).not.toHaveBeenCalled();
  });

  it("serializes relative host file writes with last-write-wins behavior", async () => {
    const rootPath = await makeTempDir("bb-command-router-app-data-");
    const initialContent = '["seed"]\n';
    await fs.writeFile(path.join(rootPath, "todos.json"), initialContent);
    const reports: HostDaemonCommandResultReportWithoutSession[] = [];
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult: async (result) => {
        reports.push(result);
      },
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      }),
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });

    await router.handleCommands([
      {
        id: "write-a",
        attemptId: "attempt-write-a",
        cursor: 1,
        command: {
          type: "host.write_file_relative",
          rootPath,
          path: "todos.json",
          dotfiles: "deny",
          content: '["a"]\n',
          contentEncoding: "utf8",
        },
      },
      {
        id: "write-b",
        attemptId: "attempt-write-b",
        cursor: 2,
        command: {
          type: "host.write_file_relative",
          rootPath,
          path: "todos.json",
          dotfiles: "deny",
          content: '["b"]\n',
          contentEncoding: "utf8",
        },
      },
    ]);

    expect(reports).toHaveLength(2);
    expect(reports.filter((report) => report.ok)).toHaveLength(2);
    const finalContent = await fs.readFile(path.join(rootPath, "todos.json"), {
      encoding: "utf8",
    });
    expect(finalContent).toBe('["b"]\n');
  });

  it("flushes buffered provider events before reporting thread command results", async () => {
    const calls: string[] = [];
    const eventSink = {
      emit: vi.fn(),
      flush: vi.fn(async () => {
        calls.push("flush");
      }),
    };
    const reportResult = vi.fn(async () => {
      calls.push("report");
    });
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      reportResult,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
        createRuntime: () => createFakeRuntime(),
      }),
      eventSink,
      logger: createLogger(),
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
    });

    await router.handleCommands([
      {
        id: "thread-start",
        attemptId: "attempt-thread-start",
        cursor: 1,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread" }],
        },
      },
    ]);

    expect(calls).toEqual(["flush", "report"]);
    expect(eventSink.flush).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight write before starting a read for the same environment", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const commitDeferred = createDeferred<{
      commitSha: string;
      commitSubject: string;
    }>();
    workspace.commit.mockReturnValueOnce(commitDeferred.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });
    const handling = router.handleCommands([
      {
        id: "commit",
        attemptId: "attempt-commit",
        cursor: 1,
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          message: "Commit",
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(workspace.commit).toHaveBeenCalledTimes(1);
    });

    const statusHandling = router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-status-after-write",
      command: {
        type: "workspace.status",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        mergeBaseBranch: "main",
      },
    });
    expect(workspace.getStatus).not.toHaveBeenCalled();

    commitDeferred.resolve({
      commitSha: "commit-1",
      commitSubject: "subject",
    });
    const response = await statusHandling;
    await handling;

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "workspace.status",
        ok: true,
        requestId: "rpc-status-after-write",
      }),
    );
    expect(workspace.getStatus).toHaveBeenCalledTimes(1);
  });

  it("runs read-only workspace commands concurrently for the same environment", async () => {
    const workspace = createFakeWorkspace("/tmp/env-1");
    const diffDeferred = createDeferred<GetDiffResult>();
    workspace.getDiff.mockReturnValueOnce(diffDeferred.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });
    const diffHandling = router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-diff-concurrent-read",
      command: {
        type: "workspace.diff",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        target: { type: "uncommitted" },
        maxDiffBytes: 100_000,
        maxFileListBytes: 100_000,
      },
    });
    const statusHandling = router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-status-concurrent-read",
      command: {
        type: "workspace.status",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        mergeBaseBranch: "main",
      },
    });

    await vi.waitFor(() => {
      expect(workspace.getDiff).toHaveBeenCalledTimes(1);
      expect(workspace.getStatus).toHaveBeenCalledTimes(1);
    });

    diffDeferred.resolve({
      diff: "",
      truncated: false,
      shortstat: "",
      files: "",
      mergeBaseRef: null,
    });
    const [diffResponse, statusResponse] = await Promise.all([
      diffHandling,
      statusHandling,
    ]);
    expect(diffResponse).toEqual(
      expect.objectContaining({
        commandType: "workspace.diff",
        ok: true,
        requestId: "rpc-diff-concurrent-read",
      }),
    );
    expect(statusResponse).toEqual(
      expect.objectContaining({
        commandType: "workspace.status",
        ok: true,
        requestId: "rpc-status-concurrent-read",
      }),
    );
  });

  it("waits for an in-flight read before starting a write for the same environment", async () => {
    const calls: string[] = [];
    const workspace = createFakeWorkspace("/tmp/env-1");
    const diffDeferred = createDeferred<void>();
    workspace.getDiff.mockImplementationOnce(async () => {
      calls.push("read:start");
      await diffDeferred.promise;
      calls.push("read:done");
      return {
        diff: "",
        truncated: false,
        shortstat: "",
        files: "",
        mergeBaseRef: null,
      };
    });
    workspace.commit.mockImplementationOnce(async () => {
      calls.push("write");
      return {
        commitSha: "commit-1",
        commitSubject: "subject",
      };
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });
    const diffHandling = router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-diff-before-write",
      command: {
        type: "workspace.diff",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        target: { type: "uncommitted" },
        maxDiffBytes: 100_000,
        maxFileListBytes: 100_000,
      },
    });

    await vi.waitFor(() => {
      expect(workspace.getDiff).toHaveBeenCalledTimes(1);
    });

    const handling = router.handleCommands([
      {
        id: "commit",
        attemptId: "attempt-commit",
        cursor: 2,
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          message: "Commit",
        },
      },
    ]);

    expect(workspace.commit).not.toHaveBeenCalled();

    diffDeferred.resolve(undefined);
    await vi.waitFor(() => {
      expect(workspace.commit).toHaveBeenCalledTimes(1);
    });

    await Promise.all([diffHandling, handling]);
    expect(calls).toEqual(["read:start", "read:done", "write"]);
  });

  it("preserves read-write-read ordering when a write is queued behind a read", async () => {
    const calls: string[] = [];
    const workspace = createFakeWorkspace("/tmp/env-1");
    const diffDeferred = createDeferred<void>();
    const commitDeferred = createDeferred<CommitResult>();
    workspace.getDiff.mockImplementationOnce(async () => {
      calls.push("read-1:start");
      await diffDeferred.promise;
      calls.push("read-1:done");
      return {
        diff: "",
        truncated: false,
        shortstat: "",
        files: "",
        mergeBaseRef: null,
      };
    });
    workspace.commit.mockImplementationOnce(async () => {
      calls.push("write:start");
      await commitDeferred.promise;
      calls.push("write:done");
      return {
        commitSha: "commit-1",
        commitSubject: "subject",
      };
    });
    workspace.getStatus.mockImplementationOnce(async () => {
      calls.push("read-2");
      return {
        workingTree: {
          hasUncommittedChanges: false,
          state: "clean",
          insertions: 0,
          deletions: 0,
          files: [],
        },
        branch: {
          currentBranch: "main",
          defaultBranch: "main",
        },
        mergeBase: null,
      };
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => createFakeRuntime(),
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });
    const diffHandling = router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-diff-before-write-read",
      command: {
        type: "workspace.diff",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        target: { type: "uncommitted" },
        maxDiffBytes: 100_000,
        maxFileListBytes: 100_000,
      },
    });

    await vi.waitFor(() => {
      expect(workspace.getDiff).toHaveBeenCalledTimes(1);
    });

    const handling = router.handleCommands([
      {
        id: "commit",
        attemptId: "attempt-commit",
        cursor: 2,
        command: {
          type: "workspace.commit",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          message: "Commit",
        },
      },
    ]);
    const statusHandling = router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-status-after-write-read",
      command: {
        type: "workspace.status",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        mergeBaseBranch: "main",
      },
    });

    expect(workspace.commit).not.toHaveBeenCalled();
    expect(workspace.getStatus).not.toHaveBeenCalled();

    diffDeferred.resolve(undefined);
    await vi.waitFor(() => {
      expect(workspace.commit).toHaveBeenCalledTimes(1);
    });
    expect(workspace.getStatus).not.toHaveBeenCalled();

    commitDeferred.resolve({
      commitSha: "commit-1",
      commitSubject: "subject",
    });
    await Promise.all([diffHandling, handling, statusHandling]);

    expect(workspace.getStatus).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "read-1:start",
      "read-1:done",
      "write:start",
      "write:done",
      "read-2",
    ]);
  });

  it("serializes thread.archive before environment.destroy for the same environment", async () => {
    const calls: string[] = [];
    const workspace = createFakeWorkspace("/tmp/env-1");
    workspace.destroy.mockImplementation(async () => {
      calls.push("destroy:workspace");
    });

    const runtime = createFakeRuntime();
    const archiveStarted = createDeferred<void>();
    const archiveDeferred = createDeferred<void>();
    runtime.archiveThread.mockImplementation(
      async (_args: ArchiveThreadArgs) => {
        calls.push("archive:start");
        archiveStarted.resolve(undefined);
        await archiveDeferred.promise;
        calls.push("archive:done");
      },
    );
    runtime.shutdown.mockImplementation(async () => {
      calls.push("destroy:runtime");
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });

    const workspaceContext = {
      workspacePath: "/tmp/env-1",
      workspaceProvisionType: "managed-worktree" as const,
    };
    const handling = router.handleCommands([
      {
        id: "archive",
        attemptId: "attempt-archive",
        cursor: 1,
        command: {
          type: "thread.archive",
          environmentId: "env-1",
          threadId: "thread-1",
          workspaceContext,
          providerId: "fake",
          providerThreadId: "provider-thread-1",
        },
      },
      {
        id: "destroy",
        attemptId: "attempt-destroy",
        cursor: 2,
        command: {
          type: "environment.destroy",
          environmentId: "env-1",
          workspaceContext,
        },
      },
    ]);

    await archiveStarted.promise;

    expect(runtime.archiveThread).toHaveBeenCalledWith({
      providerId: "fake",
      providerThreadId: "provider-thread-1",
      threadId: "thread-1",
    });
    expect(runtime.shutdown).not.toHaveBeenCalled();
    expect(workspace.destroy).not.toHaveBeenCalled();

    archiveDeferred.resolve(undefined);
    await handling;

    expect(calls).toEqual([
      "archive:start",
      "archive:done",
      "destroy:runtime",
      "destroy:workspace",
    ]);
  });

  it("waits for an in-flight thread.unarchive before resuming a turn for the same thread", async () => {
    const dataDir = await makeTempDir("bb-command-router-unarchive-");
    const calls: string[] = [];
    const runtime = createFakeRuntime();
    const unarchiveStarted = createDeferred<void>();
    const unarchiveDeferred = createDeferred<void>();
    runtime.unarchiveThread.mockImplementation(
      async (_args: UnarchiveThreadArgs) => {
        calls.push("unarchive:start");
        unarchiveStarted.resolve(undefined);
        await unarchiveDeferred.promise;
        calls.push("unarchive:done");
      },
    );
    runtime.resumeThread.mockImplementation(
      async ({ providerThreadId }: ResumeThreadArgs) => {
        calls.push("resume");
        return { providerThreadId: providerThreadId ?? "provider-resumed" };
      },
    );
    runtime.runTurn.mockImplementation(async () => {
      calls.push("runTurn");
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir,
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });

    const handling = router.handleCommands([
      {
        id: "unarchive",
        attemptId: "attempt-unarchive",
        cursor: 1,
        command: {
          type: "thread.unarchive",
          environmentId: "env-1",
          threadId: "thread-1",
          providerId: "fake",
          providerThreadId: "provider-1",
        },
      },
      {
        id: "submit",
        attemptId: "attempt-submit",
        cursor: 2,
        command: {
          type: "turn.submit",
          environmentId: "env-1",
          threadId: "thread-1",
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "after unarchive" }],
          options: {
            model: "gpt-5",
            serviceTier: "default" as const,
            reasoningLevel: "medium" as const,
            workflowsEnabled: false,
            permissionMode: "full" as const,
            permissionEscalation: null,
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: "/tmp/env-1",
              workspaceProvisionType: "unmanaged" as const,
            },
            projectId: "project-1",
            providerId: "fake",
            providerThreadId: "provider-1",
            instructions: "Be a helpful coding agent.",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append" as const,
          },
          target: { mode: "start" },
        },
      },
    ]);

    await unarchiveStarted.promise;
    // The turn must not resume the provider session while the unarchive is in
    // flight, or the provider rejects the resume as still archived.
    expect(runtime.resumeThread).not.toHaveBeenCalled();
    expect(runtime.runTurn).not.toHaveBeenCalled();

    unarchiveDeferred.resolve(undefined);
    await handling;

    expect(calls).toEqual([
      "unarchive:start",
      "unarchive:done",
      "resume",
      "runTurn",
    ]);
  });

  it("serializes thread.archive before a later thread.unarchive for the same environment", async () => {
    const calls: string[] = [];
    const runtime = createFakeRuntime();
    const archiveStarted = createDeferred<void>();
    const archiveDeferred = createDeferred<void>();
    runtime.archiveThread.mockImplementation(async () => {
      calls.push("archive:start");
      archiveStarted.resolve(undefined);
      await archiveDeferred.promise;
      calls.push("archive:done");
    });
    runtime.unarchiveThread.mockImplementation(async () => {
      calls.push("unarchive");
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });

    const handling = router.handleCommands([
      {
        id: "archive",
        attemptId: "attempt-archive",
        cursor: 1,
        command: {
          type: "thread.archive",
          environmentId: "env-1",
          threadId: "thread-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          providerId: "fake",
          providerThreadId: "provider-1",
        },
      },
      {
        id: "unarchive",
        attemptId: "attempt-unarchive",
        cursor: 2,
        command: {
          type: "thread.unarchive",
          environmentId: "env-1",
          threadId: "thread-1",
          providerId: "fake",
          providerThreadId: "provider-1",
        },
      },
    ]);

    await archiveStarted.promise;
    // The later unarchive must not run until the earlier archive completes, or
    // the slower archive could land last and leave the session archived.
    expect(runtime.unarchiveThread).not.toHaveBeenCalled();

    archiveDeferred.resolve(undefined);
    await handling;

    expect(calls).toEqual(["archive:start", "archive:done", "unarchive"]);
  });

  it("runs provider commands for different threads concurrently", async () => {
    const runtime = createFakeRuntime();
    const threadA = createDeferred<undefined>();
    const threadB = createDeferred<undefined>();
    runtime.runTurn.mockImplementation(({ threadId }: { threadId: string }) => {
      return threadId === "thread-a" ? threadA.promise : threadB.promise;
    });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    manager.markThreadActive("env-1", "thread-a", "provider-a");
    manager.markThreadActive("env-1", "thread-b", "provider-b");

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });
    const handling = router.handleCommands([
      {
        id: "run-a",
        attemptId: "attempt-run-a",
        cursor: 1,
        command: {
          type: "turn.submit",
          environmentId: "env-1",
          threadId: "thread-a",
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "A" }],
          options: {
            model: "gpt-5",
            serviceTier: "default" as const,
            reasoningLevel: "medium" as const,
            workflowsEnabled: false,
            permissionMode: "full" as const,
            permissionEscalation: null,
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: "/tmp/env-1",
              workspaceProvisionType: "unmanaged" as const,
            },
            projectId: "project-1",
            providerId: "fake",
            providerThreadId: "provider-a",
            instructions: "Be a helpful coding agent.",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append" as const,
          },
          target: { mode: "start" },
        },
      },
      {
        id: "run-b",
        attemptId: "attempt-run-b",
        cursor: 2,
        command: {
          type: "turn.submit",
          environmentId: "env-1",
          threadId: "thread-b",
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "B" }],
          options: {
            model: "gpt-5",
            serviceTier: "default" as const,
            reasoningLevel: "medium" as const,
            workflowsEnabled: false,
            permissionMode: "full" as const,
            permissionEscalation: null,
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: "/tmp/env-1",
              workspaceProvisionType: "unmanaged" as const,
            },
            projectId: "project-1",
            providerId: "fake",
            providerThreadId: "provider-b",
            instructions: "Be a helpful coding agent.",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append" as const,
          },
          target: { mode: "start" },
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledTimes(2);
    });

    threadA.resolve(undefined);
    threadB.resolve(undefined);
    await handling;
  });

  it("reports completed commands in completion order", async () => {
    const runtime = createFakeRuntime();
    const threadOne = createDeferred<{ providerThreadId: string }>();
    const threadTwo = createDeferred<{ providerThreadId: string }>();
    const threadThree = createDeferred<{ providerThreadId: string }>();
    runtime.startThread
      .mockReturnValueOnce(threadOne.promise)
      .mockReturnValueOnce(threadTwo.promise)
      .mockReturnValueOnce(threadThree.promise);

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    const reported: string[] = [];
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
      reportResult: async (result) => {
        reported.push(result.commandId);
      },
    });

    const handling = router.handleCommands([
      {
        id: "cmd-5",
        attemptId: "attempt-cmd-5",
        cursor: 5,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
      {
        id: "cmd-6",
        attemptId: "attempt-cmd-6",
        cursor: 6,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
      {
        id: "cmd-7",
        attemptId: "attempt-cmd-7",
        cursor: 7,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-3",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 3" }],
        },
      },
    ]);

    threadThree.resolve({ providerThreadId: "provider-3" });
    await vi.waitFor(() => {
      expect(reported).toEqual(["cmd-7"]);
    });

    threadOne.resolve({ providerThreadId: "provider-1" });
    await vi.waitFor(() => {
      expect(reported).toEqual(["cmd-7", "cmd-5"]);
    });

    threadTwo.resolve({ providerThreadId: "provider-2" });
    await handling;
    expect(reported).toEqual(["cmd-7", "cmd-5", "cmd-6"]);
  });

  it("captures completedAt after execution in success and error paths", async () => {
    const runtime = createFakeRuntime();
    const success = createDeferred<{ providerThreadId: string }>();
    const failure = createDeferred<{ providerThreadId: string }>();
    runtime.startThread
      .mockReturnValueOnce(success.promise)
      .mockImplementationOnce(async () => {
        await failure.promise;
        throw new Error("boom");
      });

    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => runtime,
    });
    let nowValue = 100;
    const results: Array<{
      commandId: string;
      completedAt: number;
      ok: boolean;
    }> = [];
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
      now: () => nowValue,
      reportResult: async (result) => {
        results.push({
          commandId: result.commandId,
          completedAt: result.completedAt,
          ok: result.ok,
        });
      },
    });

    const handling = router.handleCommands([
      {
        id: "success",
        attemptId: "attempt-success",
        cursor: 1,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
      {
        id: "failure",
        attemptId: "attempt-failure",
        cursor: 2,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
    ]);

    nowValue = 200;
    success.resolve({ providerThreadId: "provider-1" });
    await vi.waitFor(() => {
      expect(results.some((result) => result.commandId === "success")).toBe(
        true,
      );
    });

    nowValue = 300;
    failure.resolve({ providerThreadId: "provider-2" });
    await handling;

    expect(results).toEqual([
      { commandId: "success", completedAt: 200, ok: true },
      { commandId: "failure", completedAt: 300, ok: false },
    ]);
  });

  it("allows subsequent commands after environment.destroy", async () => {
    const destroyedWorkspace = createFakeWorkspace("/tmp/env-1");
    const recreatedWorkspace = createFakeWorkspace("/tmp/env-1");
    const runtime = createFakeRuntime();
    const manager = new RuntimeManager({
      provisionWorkspace: vi
        .fn<(options: ProvisionWorkspaceArgs) => Promise<HostWorkspace>>()
        .mockResolvedValueOnce(destroyedWorkspace)
        .mockResolvedValueOnce(recreatedWorkspace),
      createRuntime: () => runtime,
    });
    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger: createLogger(),
    });
    await router.handleCommands([
      {
        id: "destroy",
        attemptId: "attempt-destroy",
        cursor: 1,
        command: {
          type: "environment.destroy",
          environmentId: "env-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "managed-worktree",
          },
        },
      },
    ]);

    expect(manager.get("env-1")).toBeUndefined();

    await manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    const response = await router.handleOnlineRpcRequest({
      type: "host-rpc.request",
      requestId: "rpc-status-after-destroy-recreate",
      command: {
        type: "workspace.status",
        environmentId: "env-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        mergeBaseBranch: "main",
      },
    });

    expect(response).toEqual(
      expect.objectContaining({
        commandType: "workspace.status",
        ok: true,
        requestId: "rpc-status-after-destroy-recreate",
      }),
    );
    expect(recreatedWorkspace.getStatus).toHaveBeenCalledTimes(1);
  });

  it("recovers result reporting after a transient report failure", async () => {
    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => createFakeRuntime(),
    });
    const logger = createLogger();
    let shouldFail = true;
    const reported: string[] = [];
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
      reportResult: async (result) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("report failed");
        }
        reported.push(result.commandId);
      },
    });

    await router.handleCommands([
      {
        id: "cmd-1",
        attemptId: "attempt-cmd-1",
        cursor: 1,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
    ]);

    expect(reported).toEqual([]);

    await router.handleCommands([
      {
        id: "cmd-2",
        attemptId: "attempt-cmd-2",
        cursor: 2,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(reported).toEqual(["cmd-2", "cmd-1"]);
    });
    expect(logger.warn).toHaveBeenCalledWith(
      {
        err: expect.any(Error),
      },
      "failed to report command result, will retry on next completion",
    );
  });

  it("reports later command results when an older pending result keeps failing", async () => {
    const manager = new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1"),
      createRuntime: () => createFakeRuntime(),
    });
    const logger = createLogger();
    const reported: string[] = [];
    const router = new CommandRouter({
      dataDir: "/tmp/bb-test-data",
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      runtimeManager: manager,
      eventSink: noopEventSink,
      threadStorageRootPath: "/tmp/bb-test-thread-storage",
      logger,
      reportResult: async (result) => {
        if (result.commandId === "cmd-1") {
          throw new Error("stale report failed");
        }
        reported.push(result.commandId);
      },
    });

    await router.handleCommands([
      {
        id: "cmd-1",
        attemptId: "attempt-cmd-1",
        cursor: 1,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 1" }],
        },
      },
    ]);

    expect(reported).toEqual([]);

    await router.handleCommands([
      {
        id: "cmd-2",
        attemptId: "attempt-cmd-2",
        cursor: 2,
        command: {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-2",
          ...createStandardRuntimeCommandContext({
            workspacePath: "/tmp/env-1",
          }),
          requestId: nextClientRequestId(),
          input: [{ type: "text", text: "start thread 2" }],
        },
      },
    ]);

    await vi.waitFor(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        {
          err: expect.any(Error),
        },
        "failed to report pending command result, will retry on next completion",
      );
    });
    expect(reported).toEqual(["cmd-2"]);
  });
});
