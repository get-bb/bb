import {
  getEnvironment,
  getHost,
  getThread,
  hosts,
  threadExecutionOwners,
} from "@bb/db";
import { eq } from "drizzle-orm";
import type { HostDaemonRpcCommand } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { getLastProviderThreadId } from "../threads/thread-events.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";

type ExecutionDeps = Pick<
  AppDeps,
  "db" | "providerRegistry" | "pluginHostArtifacts"
>;

export function executionProviderRegistry(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  hostId: string | null,
): ProviderRegistryService {
  if (hostId === null || getHost(deps.db, hostId)?.executionIntegration == null)
    return deps.providerRegistry;
  const binding = getHost(deps.db, hostId)!.executionIntegration!;
  const integration = deps.providerRegistry.getExecutionIntegration(binding.id);
  if (integration === null || integration.pluginId !== binding.pluginId) {
    throw new ApiError(
      409,
      "execution_integration_unavailable",
      `Machine requires unavailable execution integration "${binding.displayName}" (${binding.id})`,
    );
  }
  if (
    integration.hostIds !== undefined &&
    !integration.hostIds.includes(hostId)
  )
    throw new ApiError(
      409,
      "execution_integration_incompatible_machine",
      `Execution integration "${binding.displayName}" does not support this machine`,
    );
  const get = (providerId: string) =>
    integration.providers.find((provider) => provider.info.id === providerId) ??
    null;
  return {
    ...deps.providerRegistry,
    get,
    list: () => [...integration.providers],
    getServerCapabilities: (id) => get(id)?.serverCapabilities ?? null,
    getSupportedPermissionModes: (id) =>
      get(id)?.info.capabilities.permissionModes ?? null,
    supportsFork: (id) => {
      const capability = get(id)?.serverCapabilities.fork;
      return capability !== undefined && capability !== "none";
    },
    supportsSessionRewind: (id) =>
      get(id)?.serverCapabilities.fork === "checkpoint",
    supportsManualCompaction: (id) =>
      get(id)?.serverCapabilities.supportsManualCompaction ?? false,
  };
}

export function executionIntegrationSettings(
  deps: ExecutionDeps,
  hostId: string,
) {
  const host = getHost(deps.db, hostId);
  if (!host || host.destroyedAt !== null)
    throw new ApiError(404, "host_not_found", "Host not found");
  const integrations = deps.providerRegistry
    .listExecutionIntegrations()
    .filter(
      (integration) =>
        integration.hostIds === undefined ||
        integration.hostIds.includes(hostId),
    )
    .map((integration) => ({
      id: integration.id,
      pluginId: integration.pluginId,
      displayName: integration.displayName,
      providerIds: integration.providers.map((provider) => provider.info.id),
      available:
        deps.pluginHostArtifacts.get(integration.pluginId) !== undefined,
    }));
  const binding = host.executionIntegration;
  return {
    required:
      binding === null
        ? null
        : {
            ...binding,
            available: integrations.some(
              (integration) =>
                integration.id === binding.id &&
                integration.pluginId === binding.pluginId &&
                integration.available,
            ),
          },
    integrations,
  };
}

export function setExecutionIntegration(
  deps: ExecutionDeps & Pick<AppDeps, "hub">,
  hostId: string,
  integrationId: string | null,
) {
  const settings = executionIntegrationSettings(deps, hostId);
  const integration =
    integrationId === null
      ? null
      : settings.integrations.find(
          (entry) => entry.id === integrationId && entry.available,
        );
  if (integration === undefined)
    throw new ApiError(
      409,
      "execution_integration_unavailable",
      `Execution integration "${integrationId}" is unavailable`,
    );
  deps.db
    .update(hosts)
    .set({
      executionIntegration:
        integration === null
          ? null
          : {
              id: integration.id,
              pluginId: integration.pluginId,
              displayName: integration.displayName,
            },
      updatedAt: Date.now(),
    })
    .where(eq(hosts.id, hostId))
    .run();
  deps.providerRegistry.forgetAllInstalled();
  deps.hub.notifySystem(["config-changed"]);
  deps.hub.notifyHost(hostId, ["provider-model-catalog-changed"]);
  return executionIntegrationSettings(deps, hostId);
}

export function resolveExecutionProvider(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  providerId: string,
  hostId?: string,
) {
  if (hostId === undefined) return deps.providerRegistry.get(providerId);
  const host = getHost(deps.db, hostId);
  if (host === null)
    throw new ApiError(404, "host_not_found", "Host not found");
  const binding = host.executionIntegration;
  if (binding === null) return deps.providerRegistry.get(providerId);
  const integration = deps.providerRegistry.getExecutionIntegration(binding.id);
  if (integration === null || integration.pluginId !== binding.pluginId) {
    throw new ApiError(
      409,
      "execution_integration_unavailable",
      `Machine "${host.name}" requires "${binding.displayName}" (${binding.id}), but its execution integration is unavailable`,
    );
  }
  if (
    integration.hostIds !== undefined &&
    !integration.hostIds.includes(hostId)
  )
    throw new ApiError(
      409,
      "execution_integration_incompatible_machine",
      `Execution integration "${binding.displayName}" is not compatible with machine "${host.name}"`,
    );
  const provider = integration.providers.find(
    (entry) => entry.info.id === providerId,
  );
  if (provider === undefined)
    throw new ApiError(
      409,
      "execution_integration_unsupported_provider",
      `Execution integration "${binding.displayName}" does not support harness "${providerId}" on machine "${host.name}"`,
    );
  return provider;
}

export function resolveSessionExecutionProvider(
  deps: Pick<AppDeps, "db" | "providerRegistry">,
  threadId: string,
  providerId: string,
) {
  const owner = deps.db
    .select()
    .from(threadExecutionOwners)
    .where(eq(threadExecutionOwners.threadId, threadId))
    .get();
  if (owner?.integrationId == null)
    return deps.providerRegistry.get(providerId);
  const integration = deps.providerRegistry.getExecutionIntegration(
    owner.integrationId,
  );
  if (integration?.pluginId !== owner.pluginId) return null;
  return (
    integration.providers.find((provider) => provider.info.id === providerId) ??
    null
  );
}

export function assertSessionExecutionOwner(
  deps: Pick<AppDeps, "db">,
  hostId: string,
  threadId: string,
): void {
  const binding = getHost(deps.db, hostId)?.executionIntegration ?? null;
  const owner = deps.db
    .select()
    .from(threadExecutionOwners)
    .where(eq(threadExecutionOwners.threadId, threadId))
    .get();
  if (owner !== undefined) {
    if (
      ((owner.integrationId !== null || binding !== null) &&
        owner.hostId !== hostId) ||
      owner.integrationId !== (binding?.id ?? null) ||
      (binding !== null && owner.pluginId !== binding.pluginId)
    ) {
      throw new ApiError(
        409,
        "execution_session_owner_conflict",
        "This session belongs to a different execution backend. Restore the machine's previous setting or start a new thread",
      );
    }
  } else if (
    binding !== null &&
    getLastProviderThreadId(deps, threadId) !== null
  ) {
    throw new ApiError(
      409,
      "execution_session_owner_conflict",
      "This existing session belongs to ordinary BB execution. Start a new thread to use the required integration",
    );
  }
}

export function assertExecutionIntegrationCommand(
  deps: ExecutionDeps,
  hostId: string,
  command: HostDaemonRpcCommand,
): void {
  if (!("bridgeLaunch" in command)) return;
  const providerId =
    command.type === "turn.submit"
      ? command.resumeContext.providerId
      : "providerId" in command
        ? command.providerId
        : null;
  if (providerId === null) return;
  const binding = getHost(deps.db, hostId)?.executionIntegration ?? null;
  const bridge = command.bridgeLaunch;
  const protectedExecution =
    binding !== null || bridge.executionIntegrationId !== undefined;
  const registration = protectedExecution
    ? resolveExecutionProvider(deps, providerId, hostId)
    : null;
  if (
    protectedExecution &&
    (registration === null ||
      bridge.pluginId !== registration.pluginId ||
      (bridge.executionIntegrationId ?? null) !== (binding?.id ?? null) ||
      deps.pluginHostArtifacts.get(registration.pluginId)?.digest !==
        bridge.source.digest)
  ) {
    throw new ApiError(
      409,
      "execution_integration_changed",
      "Machine execution configuration changed before dispatch; retry with its required integration",
    );
  }
  if (
    command.type === "turn.submit" &&
    JSON.stringify(command.resumeContext.bridgeLaunch) !==
      JSON.stringify(bridge)
  ) {
    throw new ApiError(
      409,
      "execution_integration_conflict",
      "Turn and resume execution backends do not match",
    );
  }
  if (
    (command.type === "thread.start" || command.type === "turn.submit") &&
    registration !== null
  ) {
    const capabilities = registration.info.capabilities;
    if (
      !capabilities.permissionModes.includes(command.options.permissionMode) ||
      !registration.serverCapabilities.reasoningLevels.includes(
        command.options.reasoningLevel,
      ) ||
      (!capabilities.supportsServiceTier &&
        command.options.serviceTier !== "default")
    ) {
      throw new ApiError(
        409,
        "execution_integration_unsupported_options",
        "The required execution integration does not support these execution options",
      );
    }
  }
  if (
    command.type !== "thread.start" &&
    command.type !== "turn.submit" &&
    command.type !== "thread.archive" &&
    command.type !== "thread.unarchive"
  )
    return;
  const thread = getThread(deps.db, command.threadId);
  if (
    thread === null ||
    getEnvironment(deps.db, command.environmentId)?.hostId !== hostId
  ) {
    throw new ApiError(
      409,
      "execution_host_mismatch",
      "Thread execution target does not match its machine",
    );
  }
  const owner = deps.db
    .select()
    .from(threadExecutionOwners)
    .where(eq(threadExecutionOwners.threadId, thread.id))
    .get();
  assertSessionExecutionOwner(deps, hostId, thread.id);
  if (command.type === "thread.start" && command.fork !== undefined) {
    const sourceId = thread.sourceThreadId ?? thread.parentThreadId;
    const sourceOwner =
      sourceId === null
        ? undefined
        : deps.db
            .select()
            .from(threadExecutionOwners)
            .where(eq(threadExecutionOwners.threadId, sourceId))
            .get();
    if (
      (sourceOwner?.integrationId ?? null) !== (binding?.id ?? null) ||
      (sourceOwner !== undefined && sourceOwner.hostId !== hostId) ||
      (binding !== null && sourceOwner?.pluginId !== binding.pluginId)
    ) {
      throw new ApiError(
        409,
        "execution_session_owner_conflict",
        "Cannot fork a session through a different execution backend or machine",
      );
    }
    if (
      registration !== null &&
      (registration.serverCapabilities.fork === "none" ||
        (command.fork.sourceProviderCheckpointId !== undefined &&
          registration.serverCapabilities.fork !== "checkpoint"))
    ) {
      throw new ApiError(
        409,
        "execution_integration_fork_unsupported",
        "The selected execution integration does not support this fork",
      );
    }
  }
  if (
    owner === undefined &&
    (command.type === "thread.start" || command.type === "turn.submit")
  ) {
    deps.db
      .insert(threadExecutionOwners)
      .values({
        threadId: thread.id,
        hostId,
        integrationId: binding?.id ?? null,
        pluginId: bridge.pluginId,
      })
      .run();
  }
}
