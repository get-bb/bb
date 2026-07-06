import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

// bb connect: pair this server to a getbb.app handle, then the server holds
// the tunnel itself (see services/connect/tunnel-service.ts). The CLI/app only
// drive these routes; they never hold the tunnel.
export function registerConnectRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.connect;

  post(routes.pair, async (context, payload) => {
    try {
      return context.json(await deps.connectTunnel.pair(payload));
    } catch (error) {
      throw new ApiError(
        502,
        "connect_pair_failed",
        error instanceof Error ? error.message : "Failed to pair",
      );
    }
  });

  get(routes.status, (context) =>
    context.json(deps.connectTunnel.status()),
  );

  post(routes.disconnect, (context) =>
    context.json(deps.connectTunnel.disconnect()),
  );
}
