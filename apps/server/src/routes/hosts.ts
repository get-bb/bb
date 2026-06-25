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
} from "../services/lib/entity-lookup.js";
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

export function registerHostRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.hosts;

  get(routes.list, (context) =>
    context.json(listPublicHostsWithStatus(deps.db)),
  );

  get(routes.get, (context) =>
    context.json(
      requireNonDestroyedHostWithStatus(deps.db, context.req.param("id")),
    ),
  );

  // Single-level directory listing for the interactive path browser. Omitting
  // `path` lists the host's home directory (resolved on the host).
  get(routes.directory, async (context, query) => {
    const hostId = context.req.param("id");
    requireNonDestroyedHostWithStatus(deps.db, hostId);
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

  post(routes.pathsExist, async (context, payload) => {
    const hostId = context.req.param("id");
    requireNonDestroyedHostWithStatus(deps.db, hostId);
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
    requireNonDestroyedHostWithStatus(deps.db, hostId);
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
    requireNonDestroyedHostWithStatus(deps.db, hostId);
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
    requireNonDestroyedHostWithStatus(deps.db, hostId);
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
