import type { PluginAppBuilder, PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { PlatformConnectionGate } from "../remote/platform-connection-gate.js";
import { FindingsPanel } from "./ui/FindingsPanel.js";

function FindingsPanelSlot(props: PluginNavPanelProps): React.JSX.Element {
  return <PlatformConnectionGate><FindingsPanel {...props} /></PlatformConnectionGate>;
}

export function registerFindingsApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.navPanel({
    id: "findings",
    title: "Findings",
    icon: "AlertTriangle",
    path: "findings",
    component: FindingsPanelSlot,
  });
}
