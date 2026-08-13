import type { PluginAppBuilder, PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { DevicePanel } from "./app/device-panel.js";
import { SerialConsole } from "./app/serial-console.js";

function FirmwareBenchPanel(props: PluginNavPanelProps): React.JSX.Element {
  return (
    <DevicePanel
      {...props}
      consoleSlot={(serialProps) => <SerialConsole {...serialProps} />}
    />
  );
}

export function registerDebugBenchApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.navPanel({
    id: "firmware-bench",
    title: "Firmware Bench",
    icon: "ElectricPlugs",
    path: "firmware-bench",
    component: FirmwareBenchPanel,
  });
}
