import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";

export function registerThreadTerminalRoutes(app: Hono, deps: AppDeps): void {
  const { get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.terminals, (context) => {
    const sessions = deps.terminalSessions.listThreadTerminals(
      context.req.param("id"),
    );
    return context.json({ sessions });
  });

  post(routes.createTerminal, async (context, payload) => {
    const session = await deps.terminalSessions.createThreadTerminal({
      payload,
      threadId: context.req.param("id"),
    });
    return context.json(session, 201);
  });

  patch(routes.updateTerminal, (context, payload) => {
    const session = deps.terminalSessions.renameThreadTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
      threadId: context.req.param("id"),
    });
    return context.json(session);
  });

  post(routes.closeTerminal, (context, payload) => {
    const session = deps.terminalSessions.closeThreadTerminal({
      payload,
      terminalId: context.req.param("terminalId"),
      threadId: context.req.param("id"),
    });
    return context.json(session);
  });
}
