import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import {
  cancelThreadSubagent,
  listThreadSubagents,
  tellThreadSubagent,
} from "../../services/threads/subagents.js";

export function registerThreadSubagentRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads.subagents;

  get(routes.list, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(await listThreadSubagents(deps, thread));
  });

  post(routes.tell, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(await tellThreadSubagent(deps, thread, payload));
  });

  post(routes.cancel, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      await cancelThreadSubagent(deps, thread, payload.childRef),
    );
  });
}
