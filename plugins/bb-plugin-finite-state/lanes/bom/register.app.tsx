import type { PluginAppBuilder } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { BomPanel } from "./app/bom-panel.js";

export function registerBomApp(app: PluginAppBuilder, _ctx: AppContext): void {
  app.slots.navPanel({
    id: "bill-of-materials",
    title: "Bill of Materials",
    icon: "PackageReceive",
    path: "bom",
    component: BomPanel,
  });
}
