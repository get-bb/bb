import {
  closeSession,
  getExperiments,
  getNonDestroyedHost,
  updateHost,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import {
  listPublicHostsWithStatus,
  requireNonDestroyedHostWithStatus,
  requirePublicStandardProject,
} from "../services/lib/entity-lookup.js";
import {
  assertUsableHostId,
  resolvePrimaryHostId,
} from "../services/hosts/primary-host.js";
import { issuePersistentHostEnrollKey } from "../services/hosts/host-enrollment.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../services/hosts/online-rpc.js";

const PROVIDER_CLI_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const FOLDER_PICKER_TIMEOUT_MS = 10 * 60 * 1000;

function providerCliInstallEventsToNdjson(
  events: readonly unknown[],
): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}

function assertMultiMachineEnabled(deps: AppDeps): void {
  if (!getExperiments(deps.db).multiMachine) {
    throw new ApiError(
      400,
      "multi_machine_disabled",
      "Multi-machine support is disabled",
    );
  }
}

function requireMutableHost(deps: AppDeps, hostId: string) {
  const host = getNonDestroyedHost(deps.db, hostId);
  if (!host) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
  return host;
}

export function registerHostRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.hosts;

  // UI-driven add-a-machine uses the same trust boundary as the rest of the
  // public API, so this route intentionally does not require loopback access.
  post(routes.createJoinCode, async (context, payload) => {
    assertMultiMachineEnabled(deps);
    const issued = await issuePersistentHostEnrollKey(deps, {
      ...(payload.hostName !== undefined
        ? { hostName: payload.hostName }
        : {}),
    });
    return context.json(
      {
        joinCode: issued.enrollKey.key,
        hostId: issued.hostId,
        expiresAt: issued.enrollKey.expiresAt,
      },
      201,
    );
  });

  get(routes.list, (context) =>
    context.json(listPublicHostsWithStatus(deps)),
  );

  get(routes.get, (context) =>
    context.json(
      requireNonDestroyedHostWithStatus(deps, context.req.param("id")),
    ),
  );

  patch(routes.update, (context, payload) => {
    assertMultiMachineEnabled(deps);
    const hostId = context.req.param("id");
    requireMutableHost(deps, hostId);
    const updated = updateHost(deps.db, deps.hub, hostId, {
      name: payload.name,
    });
    if (!updated) {
      throw new ApiError(404, "host_not_found", "Host not found");
    }
    // Host metadata currently shares the connection-change invalidation path.
    deps.hub.notifyHost(hostId, ["host-connected"]);
    return context.json(requireNonDestroyedHostWithStatus(deps, updated.id));
  });

  del(routes.delete, async (context) => {
    assertMultiMachineEnabled(deps);
    const hostId = context.req.param("id");
    const host = requireMutableHost(deps, hostId);
    if (resolvePrimaryHostId(deps) === hostId) {
      throw new ApiError(
        400,
        "primary_host_removal_refused",
        "The primary host cannot be removed",
      );
    }

    await deps.machineAuth.revokeHostAuthKeys({
      hostId,
      hostType: host.type,
    });
    const sessionId = deps.hub.getDaemonSessionIdForHost(hostId);
    if (sessionId) {
      closeSession(deps.db, deps.hub, sessionId, "expired");
      deps.hub.closeDaemonSession(sessionId, "expired");
      deps.terminalSessions.handleDaemonSessionClosed({ sessionId });
    }
    updateHost(deps.db, deps.hub, hostId, { destroyedAt: Date.now() });
    return context.json({ ok: true });
  });

  // Single-level directory listing for the interactive path browser. Omitting
  // `path` lists the host's home directory (resolved on the host).
  get(routes.directory, async (context, query) => {
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.browse_directory",
        ...(query.path ? { path: query.path } : {}),
      },
    });
    return context.json(result);
  });

  // Discovery only: resolves the daemon-local checkout convention without
  // touching the filesystem or starting a clone.
  get(routes.cloneDefaultPath, async (context, query) => {
    const hostId = context.req.param("id");
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
    return context.json(result);
  });

  post(routes.pathsExist, async (context, payload) => {
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.paths_exist",
        paths: payload.paths,
      },
    });
    return context.json(result);
  });

  post(routes.pickFolder, async (context, payload) => {
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    if (payload.clientHostId !== hostId) {
      throw new ApiError(
        409,
        "native_picker_unavailable",
        "Native folder picker is only available when the browser helper and work host are on the same machine",
      );
    }
    const result = await callHostOnlineRpc(deps, {
      hostId,
      timeoutMs: FOLDER_PICKER_TIMEOUT_MS,
      command: {
        type: "host.pick_folder",
      },
    });
    return context.json(result);
  });

  get(routes.providerCliStatus, async (context) => {
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "provider_cli.status",
      },
    });
    return context.json(result);
  });

  post(routes.providerCliInstall, async (context, payload) => {
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    const result = await callHostOnlineRpc(deps, {
      hostId,
      timeoutMs: PROVIDER_CLI_INSTALL_TIMEOUT_MS,
      command: {
        type: "provider_cli.install",
        provider: payload.provider,
        actionKind: payload.actionKind,
      },
    });
    return new Response(providerCliInstallEventsToNdjson(result.events), {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  });
}
