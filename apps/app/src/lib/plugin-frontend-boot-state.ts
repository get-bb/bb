import { useSyncExternalStore } from "react";

/**
 * Where the page's first plugin frontend load stands. Plugin registrations
 * arrive after first paint, so a route that depends on a registration cannot
 * tell "not loaded yet" from "not installed" on its own; this state is the
 * difference between a quiet placeholder and an error message that is wrong
 * for a few hundred milliseconds on every reload.
 *
 * - `idle`: no boot has been requested (system config has not resolved).
 * - `booting`: a boot is in flight; content scripts can take seconds each.
 * - `complete`: the first boot resolved or failed; registrations are as
 *   complete as that load will make them.
 *
 * The settle floor is separate: it only covers the `idle` case (a backend that
 * never answers would otherwise keep plugin routes blank forever). It never
 * finishes a boot that has started, and it never counts as completion for
 * anything that persists state, so a slow valid boot is neither reported as
 * missing nor written over as an empty registration list.
 */
type PluginFrontendBootPhase = "idle" | "booting" | "complete";

let phase: PluginFrontendBootPhase = "idle";
let settleFloorReached = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function markPluginFrontendBootStarted(): void {
  if (phase !== "idle") return;
  phase = "booting";
  notify();
}

export function markPluginFrontendsSettled(): void {
  if (phase === "complete") return;
  phase = "complete";
  notify();
}

/**
 * The settle floor elapsed. Only a boot that never started settles here; an
 * in-flight boot settles itself when it finishes.
 */
export function markPluginFrontendSettleFloorReached(): void {
  if (settleFloorReached) return;
  settleFloorReached = true;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSettledSnapshot(): boolean {
  return phase === "complete" || (phase === "idle" && settleFloorReached);
}

function getBootCompleteSnapshot(): boolean {
  return phase === "complete";
}

/**
 * Whether a plugin-dependent surface may report a plugin as missing: the
 * first boot completed, or no boot started within the settle floor. False
 * while a boot is in flight, however long it takes.
 */
export function usePluginFrontendsSettled(): boolean {
  return useSyncExternalStore(
    subscribe,
    getSettledSnapshot,
    getSettledSnapshot,
  );
}

/**
 * Whether the first boot actually completed. The gate for persisting anything
 * derived from the live registrations: the settle floor is not evidence that
 * the registrations are complete.
 */
export function usePluginFrontendBootComplete(): boolean {
  return useSyncExternalStore(
    subscribe,
    getBootCompleteSnapshot,
    getBootCompleteSnapshot,
  );
}

/** Test-only. */
export function resetPluginFrontendBootStateForTest(): void {
  phase = "idle";
  settleFloorReached = false;
}
