import type { OperationRoutes } from "../../kernel/http-door.js";
import type { AppDeps } from "../../types.js";
import type { ResolvePluginRpcCaller } from "../../request-context.js";
import { registerThreadActionRoutes } from "./actions.js";
import { registerThreadBaseRoutes } from "./base.js";
import { registerThreadDataRoutes } from "./data.js";
import { registerThreadInteractionRoutes } from "./interactions.js";
import { registerThreadTabRoutes } from "./tabs.js";

export function registerThreadRoutes(
  routes: OperationRoutes,
  deps: AppDeps,
  plugins: { resolveRpcCaller: ResolvePluginRpcCaller },
): void {
  registerThreadBaseRoutes(routes, deps);
  registerThreadActionRoutes(routes, deps, plugins);
  registerThreadDataRoutes(routes, deps);
  registerThreadInteractionRoutes(routes, deps);
  registerThreadTabRoutes(routes, deps);
}
