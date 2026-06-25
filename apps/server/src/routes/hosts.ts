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
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";

export function registerHostRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
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
}
