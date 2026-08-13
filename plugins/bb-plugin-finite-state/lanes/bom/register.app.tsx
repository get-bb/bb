import type { PluginAppBuilder, PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { PlatformConnectionGate } from "../remote/platform-connection-gate.js";
import { BomPanel } from "./app/bom-panel.js";

function BomPanelSlot(props: PluginNavPanelProps): React.JSX.Element {
  return (
    <PlatformConnectionGate>
      <BomPanel {...props} />
    </PlatformConnectionGate>
  );
}

export function registerBomApp(app: PluginAppBuilder, _ctx: AppContext): void {
  app.slots.navPanel({
    id: "bill-of-materials",
    title: "Bill of Materials",
    icon: "PackageReceive",
    path: "bom",
    component: BomPanelSlot,
  });
}
