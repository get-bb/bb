import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { registerThreadActionRoutes } from "./actions.js";
import { registerThreadBaseRoutes } from "./base.js";
import { registerThreadDataRoutes } from "./data.js";
import { registerThreadInteractionRoutes } from "./interactions.js";
import { registerThreadTabRoutes } from "./tabs.js";
import {
  createThreadWaitCoordinator,
  type ThreadWaitCoordinator,
} from "../../services/threads/wait-coordinator.js";

export function registerThreadRoutes(
  app: Hono,
  deps: AppDeps,
): ThreadWaitCoordinator {
  const waitCoordinator = createThreadWaitCoordinator({
    db: deps.db,
    hub: deps.hub,
    logger: deps.logger,
  });
  registerThreadBaseRoutes(app, deps);
  registerThreadActionRoutes(app, deps);
  registerThreadDataRoutes(app, deps, waitCoordinator);
  registerThreadInteractionRoutes(app, deps);
  registerThreadTabRoutes(app, deps);
  return waitCoordinator;
}
