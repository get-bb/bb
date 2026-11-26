import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import type { ResolvePluginRpcCaller } from "../../request-context.js";
import { registerThreadActionRoutes } from "./actions.js";
import { registerThreadBackgroundTaskRoutes } from "./background-tasks.js";
import { registerThreadBaseRoutes } from "./base.js";
import { registerThreadDataRoutes } from "./data.js";
import { registerThreadTransferRoutes } from "./transfer.js";
import { registerThreadInteractionRoutes } from "./interactions.js";
import { registerThreadTabRoutes } from "./tabs.js";

export function registerThreadRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: { resolveRpcCaller: ResolvePluginRpcCaller },
): void {
  registerThreadBaseRoutes(app, deps);
  registerThreadActionRoutes(app, deps, plugins);
  registerThreadBackgroundTaskRoutes(app, deps);
  registerThreadDataRoutes(app, deps);
  registerThreadTransferRoutes(app, deps);
  registerThreadInteractionRoutes(app, deps);
  registerThreadTabRoutes(app, deps);
}
