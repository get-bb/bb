import { useSyncExternalStore } from "react";

type PluginFrontendBootPhase = "idle" | "booting" | "complete";

let phase: PluginFrontendBootPhase = "idle";
let settleFloorReached = false;
let serverPluginsStarting = false;
let reconcilePending = false;
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

export function markPluginFrontendSettleFloorReached(): void {
  if (settleFloorReached) return;
  settleFloorReached = true;
  notify();
}

export function setServerPluginsStarting(starting: boolean): void {
  if (serverPluginsStarting === starting) return;
  serverPluginsStarting = starting;
  notify();
}

export function setPluginFrontendReconcilePending(pending: boolean): void {
  if (reconcilePending === pending) return;
  reconcilePending = pending;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSettledSnapshot(): boolean {
  return (
    !serverPluginsStarting &&
    !reconcilePending &&
    (phase === "complete" || (phase === "idle" && settleFloorReached))
  );
}

function getBootCompleteSnapshot(): boolean {
  return phase === "complete" && !serverPluginsStarting && !reconcilePending;
}

export function usePluginFrontendsSettled(): boolean {
  return useSyncExternalStore(
    subscribe,
    getSettledSnapshot,
    getSettledSnapshot,
  );
}

export function usePluginFrontendBootComplete(): boolean {
  return useSyncExternalStore(
    subscribe,
    getBootCompleteSnapshot,
    getBootCompleteSnapshot,
  );
}

export function resetPluginFrontendBootStateForTest(): void {
  phase = "idle";
  settleFloorReached = false;
  serverPluginsStarting = false;
  reconcilePending = false;
}
