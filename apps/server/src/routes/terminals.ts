import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";

export function registerTerminalRoutes(app: Hono, deps: AppDeps): void {
  const { get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.terminals;

  get(routes.list, (context) => {
    const sessions = deps.terminalSessions.listTerminals();
    return context.json({ sessions });
  });

  post(routes.create, async (context, payload) => {
    const session = await deps.terminalSessions.createTerminal({ payload });
    return context.json(session, 201);
  });

  patch(routes.update, (context, payload) => {
    const session = deps.terminalSessions.renameTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });

  post(routes.close, (context, payload) => {
    const session = deps.terminalSessions.closeTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
    });
    return context.json(session);
  });
}
