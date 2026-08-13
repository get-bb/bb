import type {
  PluginAppBuilder,
  PluginNavPanelProps,
  PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { DestructiveConfirmationInteraction, DevicePanel } from "./app/device-panel.js";
import { DESTRUCTIVE_CONFIRMATION_RENDERER_ID } from "./gating/destructive-contract.js";
import { SerialConsole } from "./app/serial-console.js";

function FirmwareBenchPanel(props: PluginNavPanelProps): React.JSX.Element {
  return (
    <DevicePanel
      {...props}
      consoleSlot={(serialProps) => <SerialConsole {...serialProps} />}
    />
  );
}

function FirmwareBenchThreadPanel({ threadId }: PluginThreadPanelProps): React.JSX.Element {
  return (
    <DevicePanel
      compact
      consoleSlot={(serialProps) => <SerialConsole {...serialProps} />}
      helperInstallThreadId={threadId}
      subPath=""
    />
  );
}

export function registerDebugBenchApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.pendingInteraction({
    id: DESTRUCTIVE_CONFIRMATION_RENDERER_ID,
    component: DestructiveConfirmationInteraction,
  });
  app.slots.navPanel({
    id: "firmware-bench",
    title: "Firmware Bench",
    icon: "ElectricPlugs",
    path: "firmware-bench",
    component: FirmwareBenchPanel,
  });
  app.slots.threadPanelAction({
    id: "firmware-bench-thread",
    title: "Firmware Bench",
    icon: "ElectricPlugs",
    component: FirmwareBenchThreadPanel,
    layout: "flush",
  });
}
