import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeOptions,
  type AgentRuntimeSkillRoot,
  type AgentRuntimeProcessExitInfo,
} from "@bb/agent-runtime";
import type { Logger } from "@bb/logger";
import type {
  AppDataPath,
  ApplicationId,
  PendingInteractionCreate,
  PendingInteractionResolution,
  ThreadEvent,
  WorkspaceProvisionType,
} from "@bb/domain";
import {
  requireThreadEventScopeTurnId,
  threadScope,
  turnScope,
} from "@bb/domain";
import type {
  HostDaemonActiveThread,
  HostDaemonEnvironmentChange,
  HostDaemonLoadedEnvironment,
  HostDaemonTrackedApplicationDataTarget,
  HostDaemonTrackedThreadTarget,
  HostDaemonInjectedSkillSource,
} from "@bb/host-daemon-contract";
import type {
  ApplicationDataWatchTarget,
  ApplicationStorageWatchError,
  DataDirSkillsWatchError,
  HostWatcher,
  InjectedSkillsObservedChange,
  ThreadStorageWatchError,
  WorkspaceWatchError,
  WorkspaceStatusWatchChangeKind,
} from "@bb/host-watcher";
import {
  provisionWorkspace,
  type HostWorkspace,
  type ProvisionWorkspaceArgs,
} from "@bb/host-workspace";
import {
  cleanupInjectedSkillStagingDirs,
  EMPTY_SKILL_CATALOG_HASH,
  stageInjectedSkillSources,
  type InjectedSkillsLogger,
} from "./injected-skills.js";

type StopWatching = () => void | Promise<void>;

const STOP_WATCHING: StopWatching = () => undefined;
const PROVIDER_MAINTENANCE_WORKSPACE_DIR = "provider-maintenance-workspace";
const PROVIDER_PROCESS_EXIT_DETAIL_MAX_LENGTH = 4000;
const LOCAL_WORKSPACE_WATCH_CHANGE_KINDS: readonly WorkspaceStatusWatchChangeKind[] =
  ["workspace-content-changed", "workspace-git-changed"];

interface RuntimeThreadState {
  activeTurnId: string | null;
  providerThreadId: string;
  status: "active" | "idle";
}

interface ThreadStorageTarget {
  environmentId: string;
  threadId: string;
}

interface ApplicationDataTarget {
  applicationId: ApplicationId;
  appDataPath: string;
}

interface WorkspaceWatchState {
  lastLocalFingerprint: string | null;
  lastSharedRefsFingerprint: string | null;
  pendingKinds: Set<WorkspaceStatusWatchChangeKind>;
  processing: Promise<void> | null;
}

interface BuildUnexpectedProviderExitEventsArgs {
  environmentId: string;
  info: AgentRuntimeProcessExitInfo;
  threads: Map<string, RuntimeThreadState>;
}

interface RuntimeSkillConfig {
  catalogHash: string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
}

interface CreateEntryArgs extends EnsureEnvironmentArgs {
  skillConfig: RuntimeSkillConfig | null;
}

interface ApplyExistingEnvironmentProvisionArgs {
  entry: RuntimeEntry;
  provision: ProvisionWorkspaceArgs | undefined;
}

interface EnsureCompatibleEntryArgs {
  entry: RuntimeEntry;
  skillConfig: RuntimeSkillConfig | null;
}

interface ReplaceEntryForSkillCatalogArgs {
  entry: RuntimeEntry;
  skillConfig: RuntimeSkillConfig;
}

function lazyProvisionOpts(
  environmentId: string,
  workspacePath: string,
  workspaceProvisionType: WorkspaceProvisionType,
  personalWorkspaceRoot?: string,
): ProvisionWorkspaceArgs {
  switch (workspaceProvisionType) {
    case "unmanaged":
      return { workspaceProvisionType: "unmanaged", path: workspacePath };
    case "managed-worktree":
      return {
        workspaceProvisionType: "reconnect-managed-worktree",
        path: workspacePath,
      };
    case "personal":
      if (!personalWorkspaceRoot) {
        throw new Error(
          "Personal workspace root is required to reconnect a personal workspace",
        );
      }
      return {
        workspaceProvisionType: "personal",
        environmentId,
        personalWorkspaceRoot,
        targetPath: workspacePath,
      };
  }
}

function toErrorMessage(error: Error): string {
  return error.message.trim().length > 0
    ? error.message
    : "Unknown workspace watch error";
}

function formatProviderProcessExitStatus(
  info: AgentRuntimeProcessExitInfo,
): string {
  if (info.signal) {
    return `signal ${info.signal}`;
  }
  if (info.code !== null) {
    return `code ${info.code}`;
  }
  return "unknown status";
}

function buildProviderProcessExitMessage(
  info: AgentRuntimeProcessExitInfo,
): string {
  return `Provider "${info.providerId}" exited unexpectedly with ${formatProviderProcessExitStatus(info)}`;
}

function buildProviderProcessExitDetail(
  info: AgentRuntimeProcessExitInfo,
): string | undefined {
  if (!info.stderr) {
    return undefined;
  }
  return `stderr:\n${info.stderr.slice(-PROVIDER_PROCESS_EXIT_DETAIL_MAX_LENGTH)}`;
}

function workspaceWatchKindsIncludeLocalState(
  changeKinds: readonly WorkspaceStatusWatchChangeKind[],
): boolean {
  return changeKinds.some((changeKind) =>
    LOCAL_WORKSPACE_WATCH_CHANGE_KINDS.includes(changeKind),
  );
}

function workspaceWatchKindsIncludeSharedRefs(
  changeKinds: readonly WorkspaceStatusWatchChangeKind[],
): boolean {
  return changeKinds.includes("shared-git-refs-changed");
}

export interface RuntimeEntry {
  environmentId: string;
  runtime: AgentRuntime;
  skillCatalogHash: string | null;
  stopWatchingStatus: StopWatching;
  workspace: HostWorkspace;
  path: string;
  terminals: Set<string>;
  threads: Map<string, RuntimeThreadState>;
}

export interface ApplicationDataChangedNotification {
  applicationId: ApplicationId;
  appDataPath: string;
  path: AppDataPath;
}

export interface ApplicationDataResyncNotification {
  applicationId: ApplicationId;
}

export interface ApplicationContentChangedNotification {
  applicationId: ApplicationId;
}

export interface InjectedSkillsChangedNotification {
  applicationId: ApplicationId | null;
  changedPaths: string[];
  sourceType: InjectedSkillsObservedChange["sourceType"];
}

export interface EnsureEnvironmentArgs {
  environmentId: string;
  injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
  personalWorkspaceRoot?: string;
  workspacePath?: string;
  workspaceProvisionType?: WorkspaceProvisionType;
  provision?: ProvisionWorkspaceArgs;
}

export interface RuntimeManagerOptions {
  bridgeBundleDir?: AgentRuntimeOptions["bridgeBundleDir"];
  createRuntime?: (options: AgentRuntimeOptions) => AgentRuntime;
  dataDir?: string;
  dataDirSkillsRootPath?: string | null;
  hostWatcher?: HostWatcher;
  logger?: Pick<Logger, "debug" | "warn">;
  provisionWorkspace?: (
    options: ProvisionWorkspaceArgs,
  ) => Promise<HostWorkspace>;
  shellEnv?: AgentRuntimeOptions["shellEnv"];
  onEvent?: (args: { environmentId: string; event: ThreadEvent }) => void;
  onCapture?: AgentRuntimeOptions["onCapture"];
  threadStorageRootPath?: string | null;
  onThreadStorageChanged?: (args: {
    environmentId: string;
    threadId: string;
  }) => void;
  appsRootPath?: string | null;
  onInjectedSkillsChanged?: (args: InjectedSkillsChangedNotification) => void;
  onApplicationStorageTargetsChanged?: () => void;
  onApplicationDataChanged?: (args: ApplicationDataChangedNotification) => void;
  onApplicationDataResync?: (args: ApplicationDataResyncNotification) => void;
  onApplicationContentChanged?: (
    args: ApplicationContentChangedNotification,
  ) => void;
  onApplicationStorageWatchError?: (args: {
    error: ApplicationStorageWatchError;
  }) => void;
  onDataDirSkillsWatchError?: (args: {
    error: DataDirSkillsWatchError;
  }) => void;
  onThreadStorageWatchError?: (args: {
    error: ThreadStorageWatchError;
  }) => void;
  onWorkspaceStatusChanged?: (args: {
    changeKinds: HostDaemonEnvironmentChange[];
    environmentId: string;
  }) => void;
  onWorkspaceStatusWatchError?: (args: { error: WorkspaceWatchError }) => void;
  onInteractiveRequest?: (
    request: PendingInteractionCreate,
  ) => Promise<PendingInteractionResolution>;
  onToolCall?: AgentRuntimeOptions["onToolCall"];
  onStderr?: AgentRuntimeOptions["onStderr"];
  onProcessExit?: AgentRuntimeOptions["onProcessExit"];
}

interface RuntimeWorkspaceWriteRootsArgs {
  appsRootPath: string | null | undefined;
  threadStorageRootPath: string | null | undefined;
  workspaceRoots: readonly string[];
}

export class RuntimeManager {
  private readonly createRuntime;
  private readonly hostWatcher;
  private readonly provisionWorkspace;
  private readonly baseShellEnv;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly pendingEntries = new Map<string, Promise<RuntimeEntry>>();
  private readonly trackedThreadStorageTargets = new Map<
    string,
    ThreadStorageTarget
  >();
  private readonly trackedApplicationDataTargets = new Map<
    ApplicationId,
    ApplicationDataTarget
  >();
  private providerMaintenanceRuntime: AgentRuntime | null = null;
  private pendingProviderMaintenanceRuntime: Promise<AgentRuntime> | null =
    null;
  private managedShellEnv: NonNullable<AgentRuntimeOptions["shellEnv"]> = {};
  private stopWatchingApplicationStorageRoot: StopWatching = STOP_WATCHING;
  private stopWatchingDataDirSkillsRoot: StopWatching = STOP_WATCHING;
  private stopWatchingThreadStorageRoot: StopWatching = STOP_WATCHING;

  constructor(private readonly options: RuntimeManagerOptions = {}) {
    this.createRuntime = options.createRuntime ?? createAgentRuntime;
    this.hostWatcher = options.hostWatcher;
    this.provisionWorkspace = options.provisionWorkspace ?? provisionWorkspace;
    this.baseShellEnv = { ...(options.shellEnv ?? {}) };
    this.ensureApplicationStorageWatcher();
    this.ensureDataDirSkillsWatcher();
  }

  private runtimeWorkspaceWriteRoots(
    args: RuntimeWorkspaceWriteRootsArgs,
  ): string[] {
    const roots = [...args.workspaceRoots];
    if (args.appsRootPath) {
      roots.push(args.appsRootPath);
    }
    if (args.threadStorageRootPath) {
      // Provider runtimes are environment-scoped and may host multiple threads.
      // BB_THREAD_STORAGE still points agents at their own thread subdirectory;
      // this root lets workspace-write sandboxes mutate that path.
      roots.push(args.threadStorageRootPath);
    }
    return [...new Set(roots)];
  }

  private async createWorkspaceWatchState(
    workspace: HostWorkspace,
  ): Promise<WorkspaceWatchState> {
    if (!workspace.isGitRepo) {
      return {
        lastLocalFingerprint: null,
        lastSharedRefsFingerprint: null,
        pendingKinds: new Set(),
        processing: null,
      };
    }

    const [lastLocalFingerprint, lastSharedRefsFingerprint] = await Promise.all(
      [
        workspace.getLocalStateFingerprint(),
        workspace.getSharedGitRefsFingerprint(),
      ],
    );
    return {
      lastLocalFingerprint,
      lastSharedRefsFingerprint,
      pendingKinds: new Set(),
      processing: null,
    };
  }

  private queueWorkspaceWatchChange(args: {
    changeKinds: readonly WorkspaceStatusWatchChangeKind[];
    environmentId: string;
    workspace: HostWorkspace;
    workspacePath: string;
    workspaceWatchState: WorkspaceWatchState;
  }): void {
    for (const changeKind of args.changeKinds) {
      args.workspaceWatchState.pendingKinds.add(changeKind);
    }
    if (args.workspaceWatchState.processing) {
      return;
    }
    this.flushWorkspaceWatchChanges(args);
  }

  private flushWorkspaceWatchChanges(args: {
    environmentId: string;
    workspace: HostWorkspace;
    workspacePath: string;
    workspaceWatchState: WorkspaceWatchState;
  }): void {
    const processing = this.processWorkspaceWatchChanges(args).finally(() => {
      if (args.workspaceWatchState.processing === processing) {
        args.workspaceWatchState.processing = null;
      }
      if (args.workspaceWatchState.pendingKinds.size > 0) {
        this.flushWorkspaceWatchChanges(args);
      }
    });
    args.workspaceWatchState.processing = processing;
  }

  private async processWorkspaceWatchChanges(args: {
    environmentId: string;
    workspace: HostWorkspace;
    workspacePath: string;
    workspaceWatchState: WorkspaceWatchState;
  }): Promise<void> {
    const pendingKinds = Array.from(args.workspaceWatchState.pendingKinds);
    args.workspaceWatchState.pendingKinds.clear();

    try {
      const changeKinds: HostDaemonEnvironmentChange[] = [];
      if (workspaceWatchKindsIncludeLocalState(pendingKinds)) {
        const nextLocalFingerprint =
          await args.workspace.getLocalStateFingerprint();
        if (
          args.workspaceWatchState.lastLocalFingerprint !== nextLocalFingerprint
        ) {
          args.workspaceWatchState.lastLocalFingerprint = nextLocalFingerprint;
          changeKinds.push("work-status-changed");
        }
      }
      if (workspaceWatchKindsIncludeSharedRefs(pendingKinds)) {
        const nextSharedRefsFingerprint =
          await args.workspace.getSharedGitRefsFingerprint();
        if (
          args.workspaceWatchState.lastSharedRefsFingerprint !==
          nextSharedRefsFingerprint
        ) {
          args.workspaceWatchState.lastSharedRefsFingerprint =
            nextSharedRefsFingerprint;
          changeKinds.push("git-refs-changed");
        }
      }
      if (changeKinds.length === 0) {
        return;
      }
      this.options.onWorkspaceStatusChanged?.({
        changeKinds,
        environmentId: args.environmentId,
      });
    } catch (error) {
      this.options.onWorkspaceStatusWatchError?.({
        error: {
          environmentId: args.environmentId,
          kind: "workspace-watch-error",
          message:
            error instanceof Error
              ? toErrorMessage(error)
              : "Unknown workspace watch error",
          rootPath: args.workspacePath,
        },
      });
    }
  }

  get(environmentId: string): RuntimeEntry | undefined {
    return this.entries.get(environmentId);
  }

  async getOrAwait(environmentId: string): Promise<RuntimeEntry | undefined> {
    const existing = this.entries.get(environmentId);
    if (existing) {
      return existing;
    }

    const pending = this.pendingEntries.get(environmentId);
    if (pending) {
      return pending;
    }

    return undefined;
  }

  hasThread(environmentId: string, threadId: string): boolean {
    return this.entries.get(environmentId)?.threads.has(threadId) ?? false;
  }

  markThreadActive(
    environmentId: string,
    threadId: string,
    providerThreadId: string,
  ): void {
    const entry = this.entries.get(environmentId);
    if (!entry) {
      return;
    }

    const current = entry.threads.get(threadId);
    entry.threads.set(threadId, {
      activeTurnId: current?.activeTurnId ?? null,
      providerThreadId,
      status: "active",
    });
    this.trackedThreadStorageTargets.set(threadId, {
      environmentId,
      threadId,
    });
    this.ensureThreadStorageWatcher();
  }

  markThreadInactive(environmentId: string, threadId: string): void {
    const current = this.entries.get(environmentId)?.threads.get(threadId);
    if (!current) {
      return;
    }

    this.entries.get(environmentId)?.threads.set(threadId, {
      ...current,
      activeTurnId: null,
      status: "idle",
    });
  }

  private markThreadTurnStarted(
    environmentId: string,
    threadId: string,
    providerThreadId: string,
    turnId: string,
  ): void {
    const entry = this.entries.get(environmentId);
    if (!entry) {
      return;
    }
    entry.threads.set(threadId, {
      activeTurnId: turnId,
      providerThreadId,
      status: "active",
    });
    this.trackedThreadStorageTargets.set(threadId, {
      environmentId,
      threadId,
    });
    this.ensureThreadStorageWatcher();
  }

  markTerminalActive(environmentId: string, terminalId: string): void {
    this.entries.get(environmentId)?.terminals.add(terminalId);
  }

  markTerminalInactive(environmentId: string, terminalId: string): void {
    this.entries.get(environmentId)?.terminals.delete(terminalId);
  }

  forgetThread(environmentId: string, threadId: string): void {
    this.entries.get(environmentId)?.threads.delete(threadId);
    this.trackedThreadStorageTargets.delete(threadId);
    this.stopWatchingThreadStorageIfNoTrackedThreads();
  }

  listActiveThreads(): HostDaemonActiveThread[] {
    const activeThreads: HostDaemonActiveThread[] = [];
    for (const entry of this.entries.values()) {
      for (const [threadId, thread] of entry.threads) {
        if (thread.status !== "active") {
          continue;
        }
        activeThreads.push({
          threadId,
        });
      }
    }
    return activeThreads;
  }

  listLoadedEnvironments(): HostDaemonLoadedEnvironment[] {
    return [...this.entries.keys()].map((environmentId) => ({
      environmentId,
    }));
  }

  getShellEnv(): NonNullable<AgentRuntimeOptions["shellEnv"]> {
    return {
      ...this.baseShellEnv,
      ...this.managedShellEnv,
    };
  }

  private getInjectedSkillsLogger(): InjectedSkillsLogger | undefined {
    return this.options.logger;
  }

  private async resolveRuntimeSkillConfig(
    args: EnsureEnvironmentArgs,
  ): Promise<RuntimeSkillConfig | null> {
    if (args.injectedSkillSources === undefined) {
      return null;
    }
    if (args.injectedSkillSources.length === 0) {
      return {
        catalogHash: EMPTY_SKILL_CATALOG_HASH,
        skillRoots: [],
      };
    }
    if (!this.options.dataDir) {
      throw new Error("Runtime skill staging requires a host dataDir");
    }
    return stageInjectedSkillSources({
      dataDir: this.options.dataDir,
      injectedSkillSources: args.injectedSkillSources,
      logger: this.getInjectedSkillsLogger(),
    });
  }

  private entryHasActiveRuntimeWork(entry: RuntimeEntry): boolean {
    if (entry.terminals.size > 0) {
      return true;
    }
    for (const thread of entry.threads.values()) {
      if (thread.status === "active") {
        return true;
      }
    }
    return false;
  }

  private async cleanupUnusedInjectedSkillStagingDirs(): Promise<void> {
    if (!this.options.dataDir) {
      return;
    }
    try {
      await cleanupInjectedSkillStagingDirs({
        dataDir: this.options.dataDir,
        keepCatalogHashes: [...this.entries.values()].flatMap((entry) =>
          entry.skillCatalogHash === null ? [] : [entry.skillCatalogHash],
        ),
        logger: this.getInjectedSkillsLogger(),
      });
    } catch (error) {
      this.options.logger?.warn(
        {
          reason:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Unable to clean injected skill staging directories",
        },
        "Failed to clean injected skill staging directories",
      );
    }
  }

  private async replaceEntryForSkillCatalog(
    args: ReplaceEntryForSkillCatalogArgs,
  ): Promise<void> {
    if (this.entryHasActiveRuntimeWork(args.entry)) {
      throw new Error(
        `Environment ${args.entry.environmentId} already has an active runtime with injected skill catalog ${args.entry.skillCatalogHash ?? "none"}; requested ${args.skillConfig.catalogHash}`,
      );
    }

    this.entries.delete(args.entry.environmentId);
    this.removeTrackedThreadStorageTargetsForEnvironment(
      args.entry.environmentId,
    );
    this.stopWatchingThreadStorageIfNoTrackedThreads();
    await this.stopWatchingStatus(args.entry);
    await args.entry.runtime.shutdown();
    await this.cleanupUnusedInjectedSkillStagingDirs();
  }

  private async ensureCompatibleEntry(
    args: EnsureCompatibleEntryArgs,
  ): Promise<RuntimeEntry | null> {
    if (
      args.skillConfig === null ||
      args.entry.skillCatalogHash === args.skillConfig.catalogHash ||
      (args.entry.skillCatalogHash === null &&
        args.skillConfig.skillRoots.length === 0)
    ) {
      return args.entry;
    }

    await this.replaceEntryForSkillCatalog({
      entry: args.entry,
      skillConfig: args.skillConfig,
    });
    return null;
  }

  replaceManagedShellEnv(
    shellEnv: NonNullable<AgentRuntimeOptions["shellEnv"]>,
  ): void {
    this.managedShellEnv = { ...shellEnv };
  }

  replaceTrackedThreadStorageTargets(
    targets: readonly HostDaemonTrackedThreadTarget[],
  ): void {
    this.trackedThreadStorageTargets.clear();
    for (const target of targets) {
      this.trackedThreadStorageTargets.set(target.threadId, {
        environmentId: target.environmentId,
        threadId: target.threadId,
      });
    }
    if (this.trackedThreadStorageTargets.size > 0) {
      this.ensureThreadStorageWatcher();
      return;
    }
    this.stopWatchingThreadStorageIfNoTrackedThreads();
  }

  replaceTrackedApplicationDataTargets(
    targets: readonly HostDaemonTrackedApplicationDataTarget[],
  ): void {
    this.trackedApplicationDataTargets.clear();
    for (const target of targets) {
      this.trackedApplicationDataTargets.set(target.applicationId, {
        applicationId: target.applicationId,
        appDataPath: target.appDataPath,
      });
    }
    this.ensureApplicationStorageWatcher();
  }

  async openWorkspace(path: string): Promise<HostWorkspace> {
    return this.provisionWorkspace({
      workspaceProvisionType: "unmanaged",
      path,
    });
  }

  async ensureProviderMaintenanceRuntime(args: {
    dataDir: string;
  }): Promise<AgentRuntime> {
    if (this.providerMaintenanceRuntime) {
      return this.providerMaintenanceRuntime;
    }
    if (this.pendingProviderMaintenanceRuntime) {
      return this.pendingProviderMaintenanceRuntime;
    }

    const creation = this.createProviderMaintenanceRuntime(args).then(
      (runtime) => {
        this.providerMaintenanceRuntime = runtime;
        return runtime;
      },
    );
    this.pendingProviderMaintenanceRuntime = creation.finally(() => {
      this.pendingProviderMaintenanceRuntime = null;
    });
    return this.pendingProviderMaintenanceRuntime;
  }

  async ensureEnvironment(args: EnsureEnvironmentArgs): Promise<RuntimeEntry> {
    const skillConfig = await this.resolveRuntimeSkillConfig(args);
    const existing = this.entries.get(args.environmentId);
    if (existing) {
      await this.applyExistingEnvironmentProvision({
        entry: existing,
        provision: args.provision,
      });
      const compatible = await this.ensureCompatibleEntry({
        entry: existing,
        skillConfig,
      });
      if (compatible) {
        return compatible;
      }
    }

    const pending = this.pendingEntries.get(args.environmentId);
    if (pending) {
      const entry = await pending;
      const compatible = await this.ensureCompatibleEntry({
        entry,
        skillConfig,
      });
      if (compatible) {
        return compatible;
      }
    }

    const creation = this.createEntry({
      ...args,
      skillConfig,
    })
      .then((entry) => {
        this.entries.set(args.environmentId, entry);
        return entry;
      })
      .finally(() => {
        this.pendingEntries.delete(args.environmentId);
      });
    this.pendingEntries.set(args.environmentId, creation);

    return creation;
  }

  private async applyExistingEnvironmentProvision(
    args: ApplyExistingEnvironmentProvisionArgs,
  ): Promise<void> {
    if (
      args.provision?.workspaceProvisionType !== "unmanaged" ||
      !args.provision.checkout
    ) {
      return;
    }
    if (args.provision.path !== args.entry.path) {
      throw new Error(
        `Cannot reprovision existing environment ${args.entry.environmentId} at a different path`,
      );
    }

    await this.provisionWorkspace(args.provision);
    this.options.onWorkspaceStatusChanged?.({
      environmentId: args.entry.environmentId,
      changeKinds: ["work-status-changed", "git-refs-changed"],
    });
  }

  async destroyEnvironment(environmentId: string): Promise<void> {
    const existing = this.entries.get(environmentId);
    const pending = this.pendingEntries.get(environmentId);
    const entry = existing ?? (pending ? await pending : undefined);

    if (!entry) {
      return;
    }

    this.entries.delete(environmentId);
    this.removeTrackedThreadStorageTargetsForEnvironment(environmentId);
    await this.stopWatchingStatus(entry);
    this.stopWatchingThreadStorageIfNoTrackedThreads();
    await entry.runtime.shutdown();
    await entry.workspace.destroy();
    await this.cleanupUnusedInjectedSkillStagingDirs();
  }

  async forgetEnvironment(environmentId: string): Promise<void> {
    const existing = this.entries.get(environmentId);
    const pending = this.pendingEntries.get(environmentId);
    let entry = existing;
    if (!entry && pending) {
      try {
        entry = await pending;
      } catch {
        entry = undefined;
      }
    }

    this.removeTrackedThreadStorageTargetsForEnvironment(environmentId);
    this.stopWatchingThreadStorageIfNoTrackedThreads();

    if (!entry) {
      return;
    }

    this.entries.delete(environmentId);
    await this.stopWatchingStatus(entry);
    await entry.runtime.shutdown();
    await this.cleanupUnusedInjectedSkillStagingDirs();
  }

  async evictIdleEnvironments(): Promise<string[]> {
    // A pending environment creation is still active work. If we evict around
    // it, the creation can resolve immediately after this sweep and resurrect
    // an idle runtime entry that missed the eviction pass.
    if (this.pendingEntries.size > 0) {
      return [];
    }

    const idleEntries = [...this.entries.values()].filter((entry) => {
      const hasActiveThread = [...entry.threads.values()].some(
        (thread) => thread.status === "active",
      );
      return !hasActiveThread && entry.terminals.size === 0;
    });

    for (const entry of idleEntries) {
      await this.stopWatchingStatus(entry);
      this.entries.delete(entry.environmentId);
    }

    const shutdownResults = await Promise.allSettled(
      idleEntries.map(async (entry) => {
        await entry.runtime.shutdown();
        return entry.environmentId;
      }),
    );
    const firstRejected = shutdownResults.find(
      (result) => result.status === "rejected",
    );
    if (firstRejected && firstRejected.status === "rejected") {
      throw firstRejected.reason;
    }

    await this.cleanupUnusedInjectedSkillStagingDirs();
    return shutdownResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }

  async shutdownAll(): Promise<void> {
    const entries = [...this.entries.values()];
    for (const pending of this.pendingEntries.values()) {
      try {
        entries.push(await pending);
      } catch {
        // Ignore failed provisions during shutdown
      }
    }
    this.entries.clear();
    this.pendingEntries.clear();
    this.trackedThreadStorageTargets.clear();
    this.trackedApplicationDataTargets.clear();

    for (const entry of entries) {
      await this.stopWatchingStatus(entry);
      await entry.runtime.shutdown();
      // Do NOT call workspace.destroy() — the server owns managed workspace
      // lifecycle via explicit environment.destroy commands. Daemon shutdown
      // should only release in-memory state and stop provider processes.
    }
    const providerMaintenanceRuntime =
      this.providerMaintenanceRuntime ??
      (this.pendingProviderMaintenanceRuntime
        ? await this.pendingProviderMaintenanceRuntime.catch(() => null)
        : null);
    this.providerMaintenanceRuntime = null;
    this.pendingProviderMaintenanceRuntime = null;
    if (providerMaintenanceRuntime) {
      await providerMaintenanceRuntime.shutdown();
    }
    await this.stopWatchingThreadStorageRoot();
    this.stopWatchingThreadStorageRoot = STOP_WATCHING;
    await this.stopWatchingApplicationStorageRoot();
    this.stopWatchingApplicationStorageRoot = STOP_WATCHING;
    await this.stopWatchingDataDirSkillsRoot();
    this.stopWatchingDataDirSkillsRoot = STOP_WATCHING;
    await this.cleanupUnusedInjectedSkillStagingDirs();
  }

  private buildUnexpectedProviderExitEvents(
    args: BuildUnexpectedProviderExitEventsArgs,
  ): ThreadEvent[] {
    const message = buildProviderProcessExitMessage(args.info);
    const detail = buildProviderProcessExitDetail(args.info);
    const events: ThreadEvent[] = [];

    for (const threadId of args.info.threadIds) {
      const thread = args.threads.get(threadId);
      if (!thread || thread.status !== "active") {
        continue;
      }

      if (thread.activeTurnId !== null) {
        events.push({
          type: "turn/completed",
          threadId,
          providerThreadId: thread.providerThreadId,
          scope: turnScope(thread.activeTurnId),
          status: "failed",
          error: { message },
        });
      }

      events.push({
        type: "system/error",
        threadId,
        scope:
          thread.activeTurnId !== null
            ? turnScope(thread.activeTurnId)
            : threadScope(),
        code: "provider_process_exited",
        message,
        ...(detail ? { detail } : {}),
      });
    }

    return events;
  }

  private async createProviderMaintenanceRuntime(args: {
    dataDir: string;
  }): Promise<AgentRuntime> {
    const workspacePath = path.join(
      args.dataDir,
      PROVIDER_MAINTENANCE_WORKSPACE_DIR,
    );
    await mkdir(workspacePath, { recursive: true });

    let runtime: AgentRuntime | null = null;
    runtime = this.createRuntime({
      workspacePath,
      additionalWorkspaceWriteRoots: this.options.appsRootPath
        ? [this.options.appsRootPath]
        : [],
      shellEnv: this.getShellEnv(),
      threadStorageRootPath: this.options.threadStorageRootPath ?? undefined,
      bridgeBundleDir: this.options.bridgeBundleDir,
      onCapture: this.options.onCapture,
      onEvent: (event) => {
        this.options.onStderr?.(
          `Dropping provider maintenance event ${event.type}; no environment owns provider-only maintenance commands.`,
          event.threadId,
        );
      },
      onToolCall:
        this.options.onToolCall ??
        (async () => ({
          contentItems: [],
          success: true,
        })),
      onInteractiveRequest: this.options.onInteractiveRequest,
      onStderr: this.options.onStderr,
      onProcessExit: (info) => {
        if (
          runtime &&
          this.providerMaintenanceRuntime === runtime &&
          runtime.listRunningProviders().length === 0
        ) {
          this.providerMaintenanceRuntime = null;
        }
        this.options.onProcessExit?.(info);
      },
    });
    return runtime;
  }

  private async createEntry(args: CreateEntryArgs): Promise<RuntimeEntry> {
    const provision =
      args.provision ??
      (args.workspacePath
        ? lazyProvisionOpts(
            args.environmentId,
            args.workspacePath,
            args.workspaceProvisionType ?? "unmanaged",
            args.personalWorkspaceRoot,
          )
        : null);

    if (!provision) {
      throw new Error(
        `Missing workspace path for environment ${args.environmentId}`,
      );
    }

    const workspace = await this.provisionWorkspace(provision);
    const [workspaceWatchState, workspaceWriteRoots] = await Promise.all([
      this.createWorkspaceWatchState(workspace),
      workspace.getAdditionalWorkspaceWriteRoots(),
    ]);
    const additionalWorkspaceWriteRoots = this.runtimeWorkspaceWriteRoots({
      appsRootPath: this.options.appsRootPath,
      threadStorageRootPath: this.options.threadStorageRootPath,
      workspaceRoots: workspaceWriteRoots,
    });
    const stopWatchingStatus = this.hostWatcher
      ? this.hostWatcher.watchWorkspace({
          environmentId: args.environmentId,
          workspacePath: workspace.path,
          onChange: (event) => {
            this.queueWorkspaceWatchChange({
              changeKinds: event.changeKinds,
              environmentId: args.environmentId,
              workspace,
              workspacePath: workspace.path,
              workspaceWatchState,
            });
          },
          onWatchError: (error) => {
            this.options.onWorkspaceStatusWatchError?.({
              error,
            });
          },
        })
      : () => undefined;
    const threads = new Map<string, RuntimeThreadState>();
    let runtime: AgentRuntime | null = null;
    try {
      runtime = this.createRuntime({
        workspacePath: workspace.path,
        additionalWorkspaceWriteRoots,
        ...(args.skillConfig
          ? { skillRoots: args.skillConfig.skillRoots }
          : {}),
        shellEnv: this.getShellEnv(),
        threadStorageRootPath: this.options.threadStorageRootPath ?? undefined,
        bridgeBundleDir: this.options.bridgeBundleDir,
        onCapture: this.options.onCapture,
        onEvent: (event) => {
          if (event.type === "thread/identity") {
            this.markThreadActive(
              args.environmentId,
              event.threadId,
              event.providerThreadId,
            );
          } else if (event.type === "turn/started") {
            this.markThreadTurnStarted(
              args.environmentId,
              event.threadId,
              event.providerThreadId,
              requireThreadEventScopeTurnId({
                type: event.type,
                scope: event.scope,
              }),
            );
          } else if (event.type === "turn/completed") {
            this.markThreadInactive(args.environmentId, event.threadId);
          }
          this.options.onEvent?.({
            environmentId: args.environmentId,
            event,
          });
        },
        onToolCall:
          this.options.onToolCall ??
          (async () => ({
            contentItems: [],
            success: true,
          })),
        onInteractiveRequest: this.options.onInteractiveRequest,
        onStderr: this.options.onStderr,
        onProcessExit: (info) => {
          if (!info.expected) {
            for (const event of this.buildUnexpectedProviderExitEvents({
              environmentId: args.environmentId,
              info,
              threads,
            })) {
              this.options.onEvent?.({
                environmentId: args.environmentId,
                event,
              });
            }
          }
          for (const threadId of info.threadIds) {
            threads.delete(threadId);
          }
          const current = this.entries.get(args.environmentId);
          if (
            current?.runtime === runtime &&
            runtime?.listRunningProviders().length === 0
          ) {
            void this.stopWatchingStatus(current);
            this.entries.delete(args.environmentId);
            this.stopWatchingThreadStorageIfNoTrackedThreads();
          }
          this.options.onProcessExit?.(info);
        },
      });
    } catch (error) {
      await stopWatchingStatus();
      throw error;
    }

    return {
      environmentId: args.environmentId,
      runtime,
      skillCatalogHash: args.skillConfig?.catalogHash ?? null,
      stopWatchingStatus,
      terminals: new Set<string>(),
      workspace,
      path: workspace.path,
      threads,
    };
  }

  private async stopWatchingStatus(entry: RuntimeEntry): Promise<void> {
    const stopWatchingStatus = entry.stopWatchingStatus;
    entry.stopWatchingStatus = STOP_WATCHING;
    await stopWatchingStatus();
  }

  private ensureThreadStorageWatcher(): void {
    if (
      !this.hostWatcher ||
      this.stopWatchingThreadStorageRoot !== STOP_WATCHING
    ) {
      return;
    }

    const threadStorageRootPath = this.options.threadStorageRootPath;
    if (!threadStorageRootPath) {
      return;
    }

    this.stopWatchingThreadStorageRoot =
      this.hostWatcher.watchThreadStorageRoot({
        threadStorageRootPath,
        resolveThreadTarget: (threadId) =>
          this.findTrackedThreadTarget(threadId),
        onChange: (event) => {
          if (event.kind === "thread-storage-changed") {
            this.options.onThreadStorageChanged?.({
              environmentId: event.environmentId,
              threadId: event.threadId,
            });
          }
        },
        onWatchError: (error) => {
          this.options.onThreadStorageWatchError?.({
            error,
          });
        },
      });
  }

  private ensureApplicationStorageWatcher(): void {
    if (
      !this.hostWatcher ||
      this.stopWatchingApplicationStorageRoot !== STOP_WATCHING
    ) {
      return;
    }

    const appsRootPath = this.options.appsRootPath;
    if (!appsRootPath) {
      return;
    }

    this.stopWatchingApplicationStorageRoot =
      this.hostWatcher.watchApplicationStorageRoot({
        appsRootPath,
        resolveApplicationTarget: (applicationId) =>
          this.findTrackedApplicationDataTarget(applicationId),
        onChange: (event) => {
          if (event.kind === "application-storage-targets-changed") {
            this.options.onApplicationStorageTargetsChanged?.();
          }
          if (event.kind === "application-data-changed") {
            this.options.onApplicationDataChanged?.({
              applicationId: event.applicationId,
              appDataPath: event.appDataPath,
              path: event.path,
            });
          }
          if (event.kind === "application-data-resync") {
            this.options.onApplicationDataResync?.({
              applicationId: event.applicationId,
            });
          }
          if (event.kind === "application-content-changed") {
            this.options.onApplicationContentChanged?.({
              applicationId: event.applicationId,
            });
          }
          if (event.kind === "injected-skills-changed") {
            this.options.onInjectedSkillsChanged?.({
              applicationId: event.applicationId,
              changedPaths: event.changedPaths,
              sourceType: event.sourceType,
            });
          }
        },
        onWatchError: (error) => {
          this.options.onApplicationStorageWatchError?.({
            error,
          });
        },
      });
  }

  private ensureDataDirSkillsWatcher(): void {
    if (
      !this.hostWatcher?.watchDataDirSkillsRoot ||
      this.stopWatchingDataDirSkillsRoot !== STOP_WATCHING
    ) {
      return;
    }

    const dataDirSkillsRootPath = this.options.dataDirSkillsRootPath;
    if (!dataDirSkillsRootPath) {
      return;
    }

    this.stopWatchingDataDirSkillsRoot =
      this.hostWatcher.watchDataDirSkillsRoot({
        dataDirSkillsRootPath,
        onChange: (event) => {
          this.options.onInjectedSkillsChanged?.({
            applicationId: event.applicationId,
            changedPaths: event.changedPaths,
            sourceType: event.sourceType,
          });
        },
        onWatchError: (error) => {
          this.options.onDataDirSkillsWatchError?.({
            error,
          });
        },
      });
  }

  private findTrackedThreadTarget(
    threadId: string,
  ): ThreadStorageTarget | null {
    return this.trackedThreadStorageTargets.get(threadId) ?? null;
  }

  private findTrackedApplicationDataTarget(
    applicationId: ApplicationId,
  ): ApplicationDataWatchTarget | null {
    return this.trackedApplicationDataTargets.get(applicationId) ?? null;
  }

  private removeTrackedThreadStorageTargetsForEnvironment(
    environmentId: string,
  ): void {
    for (const [threadId, target] of this.trackedThreadStorageTargets) {
      if (target.environmentId === environmentId) {
        this.trackedThreadStorageTargets.delete(threadId);
      }
    }
  }

  private stopWatchingThreadStorageIfNoTrackedThreads(): void {
    if (this.trackedThreadStorageTargets.size > 0) {
      return;
    }
    const stopWatchingThreadStorageRoot = this.stopWatchingThreadStorageRoot;
    this.stopWatchingThreadStorageRoot = STOP_WATCHING;
    void stopWatchingThreadStorageRoot();
  }
}
