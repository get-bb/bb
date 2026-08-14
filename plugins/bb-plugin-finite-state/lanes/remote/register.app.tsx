import type { PluginAppBuilder } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { RemoteSettingsDiagnostics } from "./remote-settings-diagnostics.js";

export function registerRemoteServicesApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.settingsSection({
    id: "remote-self-diagnosis",
    title: "Connection self-diagnosis",
    description:
      "Finite State verifies each configured remote with a cheap authenticated read at startup and whenever connection settings change.",
    component: RemoteSettingsDiagnostics,
  });
}
