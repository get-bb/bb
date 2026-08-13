import type { PluginAppBuilder } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { ToolchainAdvisoryPanel } from "./toolchain-advisory.js";

export function registerAuthoringApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.navPanel({
    id: "firmware-authoring",
    title: "Firmware Authoring",
    icon: "Code",
    path: "firmware-authoring",
    component: ToolchainAdvisoryPanel,
  });
}
