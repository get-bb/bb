import type { MiddlewareHandler } from "hono";
import { serverMovingError } from "./freeze-state.js";

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);
const SERVER_MOVE_ROUTE_PATTERN = /^\/api\/v1\/server\/move(?:\/|$)/u;

export interface ServerMoveFreezeState {
  isFrozen(): boolean;
}

export function isServerMoveFreezeExempt(
  method: string,
  path: string,
): boolean {
  return READ_METHODS.has(method) || SERVER_MOVE_ROUTE_PATTERN.test(path);
}

export function serverMoveFreezeMiddleware(
  state: ServerMoveFreezeState,
): MiddlewareHandler {
  return async (context, next) => {
    if (
      state.isFrozen() &&
      !isServerMoveFreezeExempt(context.req.method, context.req.path)
    ) {
      throw serverMovingError();
    }
    await next();
  };
}

export function serverMoveEnrollmentFreezeMiddleware(
  state: ServerMoveFreezeState,
): MiddlewareHandler {
  return async (_context, next) => {
    if (state.isFrozen()) {
      throw serverMovingError();
    }
    await next();
  };
}
