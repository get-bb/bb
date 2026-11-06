import { bytesBody } from "@bb/operations";
import { joinHostPathSegments } from "../services/lib/host-path.js";
import { serverAccess } from "../services/machines/server-access.js";
import {
  getLatestSessionForHost,
  getNonDestroyedHost,
  getPublicProjectByLocalPathSource,
  updateHost,
} from "@bb/db";
import type { OperationCaller } from "@bb/operations";
import { publicApiRoutes } from "@bb/server-contract";
import type { OperationRoutes } from "../kernel/http-door.js";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { AppDeps } from "../types.js";
import {
  getProviderInstallations,
  serializeProviderInstallation,
} from "../services/system/provider-installations.js";
import { resolveBridgeLaunchForProviderId } from "../services/system/provider-bridge-launch.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import {
  listPublicHostsWithStatus,
  requireNonDestroyedHostWithStatus,
  requirePublicStandardProject,
} from "../services/lib/entity-lookup.js";
import {
  assertUsableHostId,
  isServerMachineHost,
  resolvePrimaryHostId,
} from "../services/hosts/primary-host.js";
import { issueHostEnrollKey } from "../services/hosts/host-enrollment.js";
import {
  callHostOnlineRpcForWork,
  callHostRetryableOnlineRpc,
} from "../services/hosts/online-rpc.js";
import {
  handleHostRemoved,
  settleRemovedHostWork,
} from "../internal/session-owner-side-effects.js";
import {
  submitMachine,
  requestMachineRemoval,
  startMachineResume,
  startMachineSuspension,
  startMachineReconciliation,
  forceMachineRemoval,
  retryMachineCleanup,
  sweepProviderMachine,
} from "../services/machines/provider-orchestration.js";
import { getMachineEnrollmentService } from "../services/machines/machine-services.js";
import { manualHostCommand } from "../services/machines/manual-provider.js";
import { prepareReconnect } from "../services/machines/reconnect.js";
import { emitPluginHostDeleted } from "../services/plugins/plugin-thread-events.js";

const DISCOVERED_REPOS_MAX_DEPTH = 5;
const DISCOVERED_REPOS_SINCE_DAYS = 30;
const DISCOVERED_REPOS_LIMIT = 10;

const PROVIDER_CLI_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const FOLDER_PICKER_TIMEOUT_MS = 10 * 60 * 1000;

function providerCliInstallEventsToNdjson(events: readonly unknown[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

function requireMutableHost(deps: AppDeps, hostId: string) {
  const host = getNonDestroyedHost(deps.db, hostId);
  if (!host) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
  return host;
}

function assertHostManagementAllowed(caller: OperationCaller): void {
  if (caller.user === "machine") {
    throw new ApiError(
      403,
      "machine_host_management_forbidden",
      "Machine credentials cannot manage hosts",
    );
  }
}

function assertNotServerMachine(deps: AppDeps, hostId: string): void {
  if (isServerMachineHost(deps, hostId)) {
    throw new ApiError(
      400,
      "server_host_lifecycle_refused",
      "The server machine can't be suspended or resumed. Move the server to another machine first.",
    );
  }
}

async function revokeConnectMachineCredential(
  deps: AppDeps,
  plugins: PluginService,
  machineId: string,
): Promise<void> {
  try {
    const connectPlugin = plugins
      .list()
      .find((plugin) => plugin.source === "builtin:connect");
    if (!connectPlugin) throw new Error("connect plugin is not installed");
    const handler = plugins.getRpcHandler(connectPlugin.id, "revokeMachine");
    if (handler.outcome !== "found") {
      throw new Error(`connect plugin revoke handler is ${handler.outcome}`);
    }
    const result = await plugins.invokeRpcHandler(
      handler.owner,
      "revokeMachine",
      handler.value,
      { machineId },
      { kind: "client" },
      null,
    );
    if (!result.ok) throw new Error(result.error.message);
  } catch (error) {
    deps.logger.error(
      { err: error, machineId },
      "Host was removed locally, but its bb connect machine credential could not be revoked. Revoke this machine manually from the getbb.app dashboard.",
    );
  }
}

export function registerHostRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
  plugins: PluginService,
): void {
  const routes = publicApiRoutes.hosts;

  operations.implement(routes.create, async (payload, { caller }) => {
    assertHostManagementAllowed(caller);
    return await submitMachine(deps, payload);
  });

  operations.implement(routes.createJoinCode, async (_input, { caller }) => {
    assertHostManagementAllowed(caller);
    const issued = await issueHostEnrollKey(deps, {
      enrollSource: "public-multi-machine",
    });
    return {
      joinCode: issued.enrollKey.key,
      hostId: issued.hostId,
      expiresAt: issued.enrollKey.expiresAt,
    };
  });

  operations.implement(routes.list, (query) =>
    listPublicHostsWithStatus(deps, {
      includeCreating: query.includeCreating === "true",
      type: query.type,
    }),
  );

  operations.implement(routes.get, ({ id }) => {
    const hostId = id;
    const host = requireNonDestroyedHostWithStatus(deps, hostId);
    const session = getLatestSessionForHost(deps.db, { hostId });
    return {
      ...host,
      connectMachineId: requireMutableHost(deps, hostId).connectMachineId,
      threadStorageRootPath:
        session === null
          ? null
          : joinHostPathSegments(session.dataDir, "thread-storage"),
    };
  });

  operations.implement(routes.enrollmentCommand, async ({ id }, { caller }) => {
    assertHostManagementAllowed(caller);
    requireMutableHost(deps, id);
    return manualHostCommand(getMachineEnrollmentService(deps), id);
  });

  operations.implement(routes.reconnect, async ({ id }, { caller }) => {
    assertHostManagementAllowed(caller);
    const hostId = id;
    const host = requireMutableHost(deps, hostId);
    if (resolvePrimaryHostId(deps) === hostId || host.phase !== "active")
      throw new ApiError(
        409,
        "machine_reconnect_unavailable",
        "Only active machines other than the server's own can be reconnected",
      );
    if (deps.hub.hasDaemonForHost(hostId))
      throw new ApiError(
        409,
        "machine_reconnect_not_needed",
        "Machine is connected and doesn't need reconnecting",
      );
    return await prepareReconnect(deps, hostId);
  });

  operations.implement(routes.update, ({ id, ...payload }, { caller }) => {
    assertHostManagementAllowed(caller);
    const hostId = id;
    requireMutableHost(deps, hostId);
    const updated = updateHost(deps.db, deps.hub, hostId, {
      name: payload.name,
    });
    if (!updated) {
      throw new ApiError(404, "host_not_found", "Host not found");
    }
    deps.hub.notifyHost(hostId, ["host-connected"]);
    return requireNonDestroyedHostWithStatus(deps, updated.id);
  });

  operations.implement(
    routes.updatePermissionCeiling,
    ({ id, ...payload }, { caller }) => {
      assertHostManagementAllowed(caller);
      const hostId = id;
      requireMutableHost(deps, hostId);
      const updated = updateHost(deps.db, deps.hub, hostId, {
        maxPermissionMode: payload.maxPermissionMode,
      });
      if (!updated) {
        throw new ApiError(404, "host_not_found", "Host not found");
      }
      deps.hub.notifyHost(hostId, ["host-connected"]);
      return requireNonDestroyedHostWithStatus(deps, updated.id);
    },
  );

  operations.implement(routes.retryUpdate, ({ id }, { caller }) => {
    assertHostManagementAllowed(caller);
    const hostId = id;
    const host = requireMutableHost(deps, hostId);
    if (host.lastRejectedProtocolVersion === null) {
      throw new ApiError(
        409,
        "host_update_not_needed",
        "The machine is not waiting for a protocol update",
      );
    }
    if (host.lastRejectedProtocolVersion >= HOST_DAEMON_PROTOCOL_VERSION) {
      throw new ApiError(
        409,
        "host_cannot_self_update",
        "The machine daemon is not older than this server",
      );
    }
    deps.hub.requestHostProtocolUpdateRetry(hostId);
    return { ok: true as const };
  });

  operations.implement(routes.reconcile, ({ id }, { caller }) => {
    assertHostManagementAllowed(caller);
    const hostId = id;
    startMachineReconciliation(deps, hostId);
    return requireNonDestroyedHostWithStatus(deps, hostId);
  });

  operations.implement(routes.suspend, ({ id }, { caller }) => {
    assertHostManagementAllowed(caller);
    const hostId = id;
    assertNotServerMachine(deps, hostId);
    startMachineSuspension(deps, hostId);
    return requireNonDestroyedHostWithStatus(deps, hostId);
  });

  operations.implement(routes.resume, ({ id }, { caller }) => {
    assertHostManagementAllowed(caller);
    const hostId = id;
    assertNotServerMachine(deps, hostId);
    startMachineResume(deps, hostId);
    return requireNonDestroyedHostWithStatus(deps, hostId);
  });

  operations.implement(routes.retryCleanup, async ({ id }, { caller }) => {
    assertHostManagementAllowed(caller);
    await retryMachineCleanup(deps, id);
    return { ok: true as const };
  });

  operations.implement(routes.delete, async ({ id, ...query }, { caller }) => {
    assertHostManagementAllowed(caller);
    const hostId = id;
    if (query.force === "true") {
      await forceMachineRemoval(deps, hostId);
      return { ok: true as const };
    }
    const host = requireMutableHost(deps, hostId);
    if (resolvePrimaryHostId(deps) === hostId) {
      throw new ApiError(
        400,
        "primary_host_removal_refused",
        "The primary host cannot be removed",
      );
    }

    if (host.machineProviderId !== null) {
      requestMachineRemoval(deps, hostId);
      settleRemovedHostWork(deps, { hostId });
      await sweepProviderMachine(deps, hostId);
      return { ok: true as const };
    }

    await serverAccess.release(deps, { key: hostId, hostId });
    await deps.machineAuth.revokeHostAuthKeys({
      hostId,
    });
    const sessionId = deps.hub.getDaemonSessionIdForHost(hostId);
    if (sessionId) {
      handleHostRemoved(deps, { hostId, sessionId });
    }
    settleRemovedHostWork(deps, { hostId });
    const destroyed = updateHost(deps.db, deps.hub, hostId, {
      destroyedAt: Date.now(),
    });
    deps.lifecycleDedupers.providerModelCatalogs.forgetHost(deps, hostId);
    if (destroyed !== null) emitPluginHostDeleted(destroyed);
    if (host.connectMachineId !== null) {
      await revokeConnectMachineCredential(
        deps,
        plugins,
        host.connectMachineId,
      );
    }
    return { ok: true as const };
  });

  operations.implement(routes.discoveredRepos, async ({ id }) => {
    const hostId = id;
    assertUsableHostId(deps, { hostId });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.discover_repos",
        maxDepth: DISCOVERED_REPOS_MAX_DEPTH,
        sinceDays: DISCOVERED_REPOS_SINCE_DAYS,
        limit: DISCOVERED_REPOS_LIMIT,
      },
    });
    return {
      repos: result.repos.map((repo) => ({
        ...repo,
        projectId:
          getPublicProjectByLocalPathSource(deps.db, {
            type: "local_path",
            hostId,
            path: repo.path,
          })?.id ?? null,
      })),
      truncated: result.truncated,
      unreadableCount: result.unreadableCount,
    };
  });

  operations.implement(routes.directory, async ({ id, ...query }) => {
    const hostId = id;
    assertUsableHostId(deps, { hostId });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.browse_directory",
        ...(query.path ? { path: query.path } : {}),
      },
    });
    return result;
  });

  operations.implement(routes.cloneDefaultPath, async ({ id, ...query }) => {
    const hostId = id;
    assertUsableHostId(deps, { hostId });
    const project = requirePublicStandardProject(deps.db, query.projectId);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "project.clone_default_path",
        projectSlug: project.name,
      },
    });
    return result;
  });

  operations.implement(routes.pathsExist, async ({ id, ...payload }) => {
    const hostId = id;
    assertUsableHostId(deps, { hostId });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.paths_exist",
        paths: payload.paths,
      },
    });
    return result;
  });

  operations.implement(routes.pickFolder, async ({ id, ...payload }) => {
    const hostId = id;
    assertUsableHostId(deps, { hostId });
    if (payload.clientHostId !== hostId) {
      throw new ApiError(
        409,
        "native_picker_unavailable",
        "Native folder picker is only available when the browser helper and work host are on the same machine",
      );
    }
    const result = await callHostOnlineRpcForWork(deps, {
      hostId,
      timeoutMs: FOLDER_PICKER_TIMEOUT_MS,
      command: {
        type: "host.pick_folder",
      },
    });
    return result;
  });

  operations.implement(routes.providerCliStatus, async ({ id, ...query }) => {
    const hostId = id;
    assertUsableHostId(deps, { hostId });
    const result = await getProviderInstallations(deps, {
      hostId,
      mode: query.refresh === "true" ? "refresh" : "read",
    });
    return result;
  });

  operations.implement(
    routes.providerCliInstall,
    async ({ id, ...payload }) => {
      const hostId = id;
      assertUsableHostId(deps, { hostId });
      await deps.providerRegistry.whenProviderRegistered(payload.provider);
      const registration = deps.providerRegistry.get(payload.provider);
      if (
        registration === null ||
        !registration.info.maintenance.installation
      ) {
        throw new ApiError(
          404,
          "provider_installation_unavailable",
          `Provider installation is unavailable for ${payload.provider}`,
        );
      }
      const bridgeLaunch = resolveBridgeLaunchForProviderId(
        deps,
        payload.provider,
      );
      if (bridgeLaunch === null) {
        throw new ApiError(
          409,
          "provider_bridge_unavailable",
          `Provider bridge is unavailable for ${payload.provider}`,
        );
      }
      const result = await serializeProviderInstallation(deps, hostId, () =>
        callHostOnlineRpcForWork(deps, {
          hostId,
          timeoutMs: PROVIDER_CLI_INSTALL_TIMEOUT_MS,
          command: {
            type: "provider.installation.run",
            providerId: payload.provider,
            action: payload.actionKind,
            bridgeLaunch,
          },
        }),
      );
      if (
        result.events.some(
          (event) => event.type === "completed" && event.success,
        )
      ) {
        deps.providerRegistry.forgetInstalledKey({
          hostId,
          providerId: payload.provider,
        });
        deps.lifecycleDedupers.providerModelCatalogs.clearFailure(
          hostId,
          payload.provider,
        );
      }
      return bytesBody(
        new TextEncoder().encode(providerCliInstallEventsToNdjson(result.events)),
        {
          contentType: "application/x-ndjson; charset=utf-8",
          headers: { "cache-control": "no-store" },
        },
      );
    },
  );
}
