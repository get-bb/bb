import type {
  PluginAppBuilder,
  PluginNavPanelProps,
  PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import type { AppContext } from "../../lib/app-context.js";
import { PlatformConnectionGate } from "../remote/platform-connection-gate.js";
import { BenchPanel } from "./app/bench-panel.js";
import { BenchThreadRunDetail } from "./app/run-detail.js";

function BenchPanelSlot(props: PluginNavPanelProps): React.JSX.Element {
  return (
    <PlatformConnectionGate>
      <BenchPanel {...props} />
    </PlatformConnectionGate>
  );
}

function BenchThreadPanelSlot(
  props: PluginThreadPanelProps,
): React.JSX.Element {
  return <BenchThreadRunDetail {...props} />;
}

export function registerBenchApp(
  app: PluginAppBuilder,
  _ctx: AppContext,
): void {
  app.slots.navPanel({
    id: "verification-bench",
    title: "Verification Bench",
    icon: "ChartColumn",
    path: "bench",
    component: BenchPanelSlot,
  });
  app.slots.threadPanelAction({
    id: "bench-run-detail",
    title: "Bench run evidence",
    icon: "ChartColumn",
    component: BenchThreadPanelSlot,
    layout: "flush",
  });
}
