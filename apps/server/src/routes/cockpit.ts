import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { createServerCockpitControl } from "../services/cockpit/cockpit-control.js";

export function registerCockpitRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.cockpit;
  const control = createServerCockpitControl(deps);

  get(routes.discover, async (context, query) => {
    return context.json(
      await control.discover({
        hostId: query.hostId ?? null,
      }),
    );
  });

  post(routes.act, async (context, payload) => {
    return context.json(await control.act(payload));
  });
}
