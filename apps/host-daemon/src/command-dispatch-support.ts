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
import { z } from "zod";
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

export function isExpectedCommandDispatchError<T>(
  error: T,
): error is T & ExpectedCommandDispatchError {
  return error instanceof ExpectedCommandDispatchError;
}

const EXPECTED_ONLINE_RPC_FAILURE_CODES = new Set([
  "file_too_large",
  "provision_cancelled",
]);

export function isExpectedOnlineRpcFailureError<T>(error: T): boolean {
  return (
    isExpectedCommandDispatchError(error) ||
    EXPECTED_ONLINE_RPC_FAILURE_CODES.has(getErrorCode(error))
  );
}

const MISSING_EXECUTABLE_PATTERN = /\bENOENT\b/;
const SPAWN_PATTERN = /\bspawn\b/;

export async function resolveRuntimeBridgeLaunch(
  bridgeLaunch: HostDaemonBridgeLaunch,
  options: Pick<
    CommandDispatchOptions,
    "dataDir" | "fetchPluginHostArtifact" | "logger"
  >,
): Promise<AgentRuntimeBridgeLaunch> {
  const capabilities = {
    ...bridgeLaunch.capabilities,
    permissionModes: [...bridgeLaunch.capabilities.permissionModes],
  };
  const providerOptions = { ...bridgeLaunch.providerOptions };
  const envPassthrough = [...bridgeLaunch.envPassthrough];
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

const commandErrorMetadataSchema = z.object({
  code: z.string().optional(),
  syscall: z.string().optional(),
});

function parseCommandErrorMetadata<T>(error: T) {
  if (!(error instanceof Error)) {
    return null;
  }
  const parsedError = commandErrorMetadataSchema.safeParse(error);
  return parsedError.success ? parsedError.data : null;
}

export function getErrorCode<T>(error: T): string {
  if (error instanceof CommandDispatchError) {
    return error.code;
  }
  if (isStructuredSpawnMissingExecutableError(error)) {
    return "missing_executable";
  }
  const parsedError = parseCommandErrorMetadata(error);
  if (parsedError?.code !== undefined) {
    return parsedError.code;
  }
  if (isMessageOnlySpawnMissingExecutableError(error)) {
    return "missing_executable";
  }
  return "command_failed";
}

function isStructuredSpawnMissingExecutableError<T>(error: T): boolean {
  const parsedError = parseCommandErrorMetadata(error);
  return (
    parsedError?.code === "ENOENT" &&
    parsedError.syscall?.startsWith("spawn") === true
  );
}

function isMessageOnlySpawnMissingExecutableError<T>(error: T): boolean {
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

  const ensureEnvironmentArgs: Parameters<
    RuntimeManager["ensureEnvironment"]
  >[0] = {
    environmentId: args.environmentId,
    workspacePath: args.workspaceContext.workspacePath,
    workspaceProvisionType: args.workspaceContext.workspaceProvisionType,
  };
  if (args.injectedSkillSources !== undefined) {
    ensureEnvironmentArgs.injectedSkillSources = args.injectedSkillSources;
  }
  if (args.targetThreadId !== undefined) {
    ensureEnvironmentArgs.targetThreadId = args.targetThreadId;
  }
  if (args.dataDir) {
    ensureEnvironmentArgs.personalWorkspaceRoot = getPersonalWorkspaceRoot(
      args.dataDir,
    );
  }
  return runtimeManager.ensureEnvironment(ensureEnvironmentArgs);
}
