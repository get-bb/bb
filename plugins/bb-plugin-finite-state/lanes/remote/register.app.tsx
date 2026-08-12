import type { PluginAppBuilder } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";

export function registerRemoteServicesApp(
  _app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  // no-op — external services have no direct frontend registration.
}
