import type { AgentRuntimeBridgeLaunch } from "@bb/agent-runtime";
import type { AvailableModel } from "@bb/domain";
import type { EventSinkInput } from "./event-sink.js";
import type {
  HostDaemonCommand,
  ProviderHealthResult,
  ProviderUsageResult,
  HostDaemonBridgeLaunch,
  HostDaemonInjectedSkillSource,
  HostDaemonOnlineRpcCommand,
  HostDaemonConnectTunnelIdentity,
  WorkspaceContext,
} from "@bb/host-daemon-contract";
import type {
  ProviderInstallationCommand,
  ProviderInstallationRunResult,
  ProviderInstallationStatus,
} from "@bb/provider-bridge-protocol";
import { getPersonalWorkspaceRoot } from "@bb/host-workspace";
import { ensurePluginProcessDataDir } from "@bb/process-utils";
import type { InteractiveResolveCommandInput } from "./interactive-request-registry.js";
import { RuntimeManager, type RuntimeEntry } from "./runtime-manager.js";
import type { TerminalManager } from "./terminals/terminal-manager.js";
import type { FetchProjectAttachment } from "./project-attachments.js";
import type { FetchSkillTree } from "./skill-trees.js";
import type { HostDaemonLogger } from "./logger.js";
import {
  ensureCachedPluginHostArtifact,
  type FetchPluginHostArtifact,
} from "./plugin-host-artifact-cache.js";

type DispatchCommand = HostDaemonCommand | HostDaemonOnlineRpcCommand;

export type CommandOf<TType extends DispatchCommand["type"]> = Extract<
  DispatchCommand,
  { type: TType }
>;

export interface EventSink {
  emit: (event: EventSinkInput) => void;
  flush: () => Promise<void>;
}

export const noopEventSink: EventSink = {
  emit: () => undefined,
  flush: async () => undefined,
};

export interface CommandDispatchOptions {
  dataDir: string;
  logger: Pick<HostDaemonLogger, "debug" | "warn">;
  fetchProjectAttachment: FetchProjectAttachment;
  fetchSkillTree?: FetchSkillTree;
  fetchPluginHostArtifact?: FetchPluginHostArtifact;
  runtimeManager: RuntimeManager;
  terminalManager?: Pick<TerminalManager, "closeEnvironmentTerminals">;
  eventSink: EventSink;
  listModels: (args: {
    providerId: string;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<{
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  }>;
  providerHealth: (args: {
    providerId: string;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<ProviderHealthResult>;
  providerUsage: (args: {
    providerId: string;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<ProviderUsageResult>;
  providerInstallationStatus: (args: {
    providerId: string;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
    requirement?: "thread_rewind";
  }) => Promise<ProviderInstallationStatus>;
  providerInstallationRun: (args: {
    providerId: string;
    action: "install" | "update";
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<ProviderInstallationRunResult>;
  streamProviderInstallation?: (args: {
    providerId: string;
    plan: ProviderInstallationCommand;
    env?: NodeJS.ProcessEnv;
  }) => ReadableStream<Uint8Array>;
  /**
   * Re-reads the login shell's environment into the runtime manager once its
   * short refresh window has lapsed, which is where a PATH change clears the
   * provider-CLI gate and evicts idle runtimes. The gate in front of thread
   * start and rewind awaits this before it consults its memo, because a PATH
   * change is what makes a remembered probe wrong and the manager only learns
   * about one through this refresh. Daemon-internal: nothing on the wire
   * changes.
   */
  refreshShellEnv: () => Promise<void>;
  resolveInteractiveRequest?: (
    request: InteractiveResolveCommandInput,
  ) => Promise<void>;
  ensureConnectTunnelIdentity?: () => Promise<HostDaemonConnectTunnelIdentity>;
  threadStorageRootPath: string;
}

export class CommandDispatchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandDispatchError";
  }
}

export class ExpectedCommandDispatchError extends CommandDispatchError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ExpectedCommandDispatchError";
  }
}

export function isExpectedCommandDispatchError(
  error: unknown,
): error is ExpectedCommandDispatchError {
  return error instanceof ExpectedCommandDispatchError;
}

const EXPECTED_ONLINE_RPC_FAILURE_CODES = new Set([
  "file_too_large",
  "provision_cancelled",
]);

export function isExpectedOnlineRpcFailureError(error: unknown): boolean {
  return (
    isExpectedCommandDispatchError(error) ||
    EXPECTED_ONLINE_RPC_FAILURE_CODES.has(getErrorCode(error))
  );
}

const MISSING_EXECUTABLE_PATTERN = /\bENOENT\b/;
const SPAWN_PATTERN = /\bspawn\b/;

/**
 * Turn a wire `bridgeLaunch` into the runtime shape: the artifact source is
 * resolved to a verified local path (downloading + hash-verifying if needed).
 * The source travels through, so the runtime routes on the server's explicit
 * answer rather than re-deriving it from the provider id.
 */
export async function resolveRuntimeBridgeLaunch(
  bridgeLaunch: HostDaemonBridgeLaunch,
  options: Pick<
    CommandDispatchOptions,
    "dataDir" | "fetchPluginHostArtifact" | "logger"
  >,
): Promise<AgentRuntimeBridgeLaunch> {
  // Wire and runtime shapes share one noun set, so the block carries over
  // whole; only the mutable permission-mode array is copied.
  const capabilities = {
    ...bridgeLaunch.capabilities,
    permissionModes: [...bridgeLaunch.capabilities.permissionModes],
  };
  const providerOptions = { ...bridgeLaunch.providerOptions };
  const envPassthrough = [...bridgeLaunch.envPassthrough];
  // Every bridge is scoped to the plugin that ships it: it gets that plugin's
  // own persistent directory, the same one the plugin's host worker would
  // get, under its own `bridge-data` kind.
  const dataDir = await ensurePluginProcessDataDir({
    daemonDataDir: options.dataDir,
    pluginId: bridgeLaunch.pluginId,
    kind: "bridge-data",
  });
  if (options.fetchPluginHostArtifact === undefined) {
    throw new CommandDispatchError(
      "provider_bridge_unavailable",
      "This daemon has no plugin host artifact fetcher configured",
    );
  }
  const artifactPath = await ensureCachedPluginHostArtifact({
    dataDir: options.dataDir,
    pluginId: bridgeLaunch.pluginId,
    fetchArtifact: options.fetchPluginHostArtifact,
    digest: bridgeLaunch.source.digest,
    byteLength: bridgeLaunch.source.byteLength,
    logger: options.logger,
  });
  return {
    pluginId: bridgeLaunch.pluginId,
    dataDir,
    source: {
      kind: "artifact",
      digest: bridgeLaunch.source.digest,
      artifactPath,
    },
    capabilities,
    providerOptions,
    envPassthrough,
  };
}

export function getErrorCode(error: unknown): string {
  if (error instanceof CommandDispatchError) {
    return error.code;
  }
  if (isStructuredSpawnMissingExecutableError(error)) {
    return "missing_executable";
  }
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (isMessageOnlySpawnMissingExecutableError(error)) {
    return "missing_executable";
  }
  return "command_failed";
}

function isStructuredSpawnMissingExecutableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    "code" in error &&
    error.code === "ENOENT" &&
    "syscall" in error &&
    typeof error.syscall === "string" &&
    error.syscall.startsWith("spawn")
  );
}

function isMessageOnlySpawnMissingExecutableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    MISSING_EXECUTABLE_PATTERN.test(error.message) &&
    SPAWN_PATTERN.test(error.message)
  );
}

export async function requireWorkspaceEnvironment(
  args: {
    dataDir?: string;
    environmentId: string;
    injectedSkillSources?: readonly HostDaemonInjectedSkillSource[];
    /**
     * Set by thread commands that resolve with injectedSkillSources, so a
     * busy runtime is reused instead of conflicting; see EnsureEnvironmentArgs.
     */
    targetThreadId?: string;
    workspaceContext: WorkspaceContext;
  },
  runtimeManager: RuntimeManager,
): Promise<RuntimeEntry> {
  const existing = await runtimeManager.getOrAwait(args.environmentId);
  if (existing) {
    if (existing.path !== args.workspaceContext.workspacePath) {
      await runtimeManager.forgetEnvironment(args.environmentId);
      throw new ExpectedCommandDispatchError(
        "workspace_type_mismatch",
        `Loaded environment ${args.environmentId} is bound to ${existing.path}, not ${args.workspaceContext.workspacePath}`,
      );
    }
  }

  return runtimeManager.ensureEnvironment({
    environmentId: args.environmentId,
    ...(args.injectedSkillSources !== undefined
      ? { injectedSkillSources: args.injectedSkillSources }
      : {}),
    ...(args.targetThreadId !== undefined
      ? { targetThreadId: args.targetThreadId }
      : {}),
    ...(args.dataDir
      ? { personalWorkspaceRoot: getPersonalWorkspaceRoot(args.dataDir) }
      : {}),
    workspacePath: args.workspaceContext.workspacePath,
    workspaceProvisionType: args.workspaceContext.workspaceProvisionType,
  });
}
