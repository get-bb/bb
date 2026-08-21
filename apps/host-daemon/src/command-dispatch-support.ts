import {
  createAgentRuntime,
  fingerprintAcpLaunchSpec,
  bridgeLaunchProcessKey,
  type AgentRuntime,
  type AgentRuntimeBridgeLaunch,
} from "@bb/agent-runtime";
import type { AvailableModel } from "@bb/domain";
import type { EventSinkInput } from "./event-sink.js";
import type {
  HostDaemonCommand,
  HostDaemonAcpLaunchSpec,
  ProviderHealthResult,
  ProviderUsageResult,
  HostDaemonBridgeLaunch,
  HostDaemonInjectedSkillSource,
  HostDaemonOnlineRpcCommand,
  HostDaemonConnectTunnelIdentity,
  WorkspaceContext,
} from "@bb/host-daemon-contract";
import type {
  ExperimentalProviderInstallationCommand,
  ExperimentalProviderInstallationRunResult,
  ExperimentalProviderInstallationStatus,
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
  listModels?: (args: {
    providerId: string;
    acpLaunchSpec?: HostDaemonAcpLaunchSpec;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<{
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  }>;
  providerHealth?: (args: {
    providerId: string;
    acpLaunchSpec?: HostDaemonAcpLaunchSpec;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<ProviderHealthResult>;
  providerUsage?: (args: {
    providerId: string;
    acpLaunchSpec?: HostDaemonAcpLaunchSpec;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<ProviderUsageResult>;
  providerInstallationStatus?: (args: {
    providerId: string;
    acpLaunchSpec?: HostDaemonAcpLaunchSpec;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
    requirement?: "thread_rewind";
  }) => Promise<ExperimentalProviderInstallationStatus>;
  providerInstallationRun?: (args: {
    providerId: string;
    action: "install" | "update";
    acpLaunchSpec?: HostDaemonAcpLaunchSpec;
    bridgeLaunch: AgentRuntimeBridgeLaunch;
    cwd?: string;
  }) => Promise<ExperimentalProviderInstallationRunResult>;
  streamProviderInstallation?: (args: {
    providerId: string;
    plan: ExperimentalProviderInstallationCommand;
    env?: NodeJS.ProcessEnv;
  }) => ReadableStream<Uint8Array>;
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
const ACP_AUTH_REQUIRED_PATTERN =
  /ACP agent is (?:installed but )?not authenticated|Authentication required.*(?:agent login|CURSOR_API_KEY|CURSOR_AUTH_TOKEN|api key|auth token|login)/is;

/**
 * Turn a wire `bridgeLaunch` into the runtime shape. An `artifact` source is
 * resolved to a verified local path (downloading + hash-verifying if needed);
 * a `daemon-bundled` source names a bridge inside this daemon's own bundle and
 * needs no fetch. The source travels through, so the runtime routes on the
 * server's explicit answer rather than re-deriving it from the provider id.
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
  // Every bridge, artifact or bundled, is scoped to the plugin that ships it:
  // it gets that plugin's own persistent directory, the same one the plugin's
  // host worker would get, under its own `bridge-data` kind.
  const dataDir = await ensurePluginProcessDataDir({
    daemonDataDir: options.dataDir,
    pluginId: bridgeLaunch.pluginId,
    kind: "bridge-data",
  });
  if (bridgeLaunch.source.kind === "daemon-bundled") {
    return {
      pluginId: bridgeLaunch.pluginId,
      dataDir,
      source: { ...bridgeLaunch.source },
      capabilities,
      providerOptions,
      envPassthrough,
    };
  }
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

const defaultProviderMaintenanceRuntimes = new Map<string, AgentRuntime>();

export async function shutdownDefaultProviderMaintenanceRuntimes(): Promise<void> {
  const runtimes = [...defaultProviderMaintenanceRuntimes.values()];
  defaultProviderMaintenanceRuntimes.clear();
  await Promise.all(runtimes.map((runtime) => runtime.shutdown()));
}

export async function defaultListModels(args: {
  providerId: string;
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch: AgentRuntimeBridgeLaunch;
}): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  const runtime = defaultProviderMaintenanceRuntime(args);
  try {
    return await runtime.listModels(args);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unsupported provider")
    ) {
      throw new CommandDispatchError("unknown_provider", error.message);
    }
    throw error;
  }
}

function defaultProviderMaintenanceRuntime(args: {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch: AgentRuntimeBridgeLaunch;
}): AgentRuntime {
  const runtimeKey =
    `#bridge:${bridgeLaunchProcessKey(args.bridgeLaunch)}` +
    (args.acpLaunchSpec !== undefined
      ? `#acp:${fingerprintAcpLaunchSpec(args.acpLaunchSpec)}`
      : "");
  let runtime = defaultProviderMaintenanceRuntimes.get(runtimeKey);
  if (!runtime) {
    runtime = createAgentRuntime({
      workspacePath: process.cwd(),
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [],
        success: true,
      }),
    });
    defaultProviderMaintenanceRuntimes.set(runtimeKey, runtime);
  }
  return runtime;
}

export async function defaultProviderHealth(args: {
  providerId: string;
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  cwd?: string;
}): Promise<ProviderHealthResult> {
  return await defaultProviderMaintenanceRuntime(args).providerHealth(args);
}

export async function defaultProviderUsage(args: {
  providerId: string;
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  cwd?: string;
}): Promise<ProviderUsageResult> {
  return await defaultProviderMaintenanceRuntime(args).providerUsage(args);
}

export async function defaultProviderInstallationStatus(args: {
  providerId: string;
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  cwd?: string;
  requirement?: "thread_rewind";
}): Promise<ExperimentalProviderInstallationStatus> {
  const runtime = defaultProviderMaintenanceRuntime(args);
  return await runtime.providerInstallationStatus(args);
}

export async function defaultProviderInstallationRun(args: {
  providerId: string;
  action: "install" | "update";
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  cwd?: string;
}): Promise<ExperimentalProviderInstallationRunResult> {
  const runtime = defaultProviderMaintenanceRuntime(args);
  return await runtime.providerInstallationRun(args);
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
  if (isMessageOnlyAcpAuthRequiredError(error)) {
    return "auth_required";
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

function isMessageOnlyAcpAuthRequiredError(error: unknown): boolean {
  return (
    error instanceof Error && ACP_AUTH_REQUIRED_PATTERN.test(error.message)
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
