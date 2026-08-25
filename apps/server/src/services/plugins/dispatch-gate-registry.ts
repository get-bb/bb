import type {
  PluginDispatchGateHandler,
  PluginDispatchGateStage,
} from "@get-bb/plugin-sdk";

/** One plugin's gate for one stage. */
export interface DispatchGateRegistration<S extends PluginDispatchGateStage> {
  pluginId: string;
  handler: PluginDispatchGateHandler<S>;
}

/** What one wrapped gate invocation returned, or why it did not. */
export type DispatchGateInvocation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Everything the gate runner needs from the plugin service. It is an
 * interface rather than a direct import because the runner runs on the
 * thread-dispatch hot path, which is assembled long before the plugin service
 * exists — the same reason `plugin-thread-events.ts` bridges the lifecycle
 * seams — and because it is the seam a test substitutes fake gates through.
 */
export interface DispatchGateProvider {
  /** Registered gates for a stage, in plugin install order. */
  listGates<S extends PluginDispatchGateStage>(
    stage: S,
  ): DispatchGateRegistration<S>[];
  /**
   * Runs one gate through the plugin service's failure isolation (handler
   * stats, plugin status detail, plugin log), so a gate that throws is as
   * visible as any other misbehaving handler even though the runner then
   * fails the dispatch on top of that.
   */
  invokeGate<T>(
    pluginId: string,
    label: string,
    run: () => Promise<T>,
  ): Promise<DispatchGateInvocation<T>>;
  /** Per-gate decision box in milliseconds. */
  readonly decisionTimeoutMs: number;
}

/**
 * Module-level bridge, registered once by createApp exactly like
 * {@link setPluginThreadEventEmitter}. Unset — every isolated thread test that
 * never builds an app — there are no gates at all, which is precisely the
 * zero-overhead path: the runner returns without taking its lock.
 */
let provider: DispatchGateProvider | undefined;

export function setDispatchGateProvider(
  next: DispatchGateProvider | undefined,
): void {
  provider = next;
}

export function dispatchGateProvider(): DispatchGateProvider | undefined {
  return provider;
}
