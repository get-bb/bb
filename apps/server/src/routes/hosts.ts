import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  listPublicHostsWithStatus,
  requireNonDestroyedHostWithStatus,
} from "../services/lib/entity-lookup.js";

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
}
