import { AsyncLocalStorage } from "node:async_hooks";
import type { PluginUpdatePhase } from "@bb/server-contract";

const progress = new AsyncLocalStorage<(phase: PluginUpdatePhase) => void>();

export function withPluginUpdateProgress<T>(
  report: (phase: PluginUpdatePhase) => void,
  run: () => Promise<T>,
): Promise<T> {
  return progress.run(report, run);
}

export function reportPluginUpdatePhase(phase: PluginUpdatePhase): void {
  progress.getStore()?.(phase);
}
