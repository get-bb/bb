import { useEffect, useSyncExternalStore } from "react";
import type { PluginAppOnDemandSurface } from "@bb/domain";

const demandedSurfaces = new Set<PluginAppOnDemandSurface>();
const demandListeners = new Set<() => void>();

export function isPluginSurfaceDemanded(
  surface: PluginAppOnDemandSurface,
): boolean {
  return demandedSurfaces.has(surface);
}

export function demandPluginSurface(surface: PluginAppOnDemandSurface): void {
  if (demandedSurfaces.has(surface)) return;
  demandedSurfaces.add(surface);
  for (const listener of [...demandListeners]) listener();
}

export function onPluginSurfaceDemand(listener: () => void): () => void {
  demandListeners.add(listener);
  return () => {
    demandListeners.delete(listener);
  };
}

export function usePluginSurfaceDemand(
  surface: PluginAppOnDemandSurface,
): void {
  useEffect(() => {
    demandPluginSurface(surface);
  }, [surface]);
}

let onDemandFrontendsDeferred = false;
const deferredListeners = new Set<() => void>();

export function setOnDemandPluginFrontendsDeferred(deferred: boolean): void {
  if (onDemandFrontendsDeferred === deferred) return;
  onDemandFrontendsDeferred = deferred;
  for (const listener of [...deferredListeners]) listener();
}

function subscribeDeferred(listener: () => void): () => void {
  deferredListeners.add(listener);
  return () => {
    deferredListeners.delete(listener);
  };
}

function getDeferredSnapshot(): boolean {
  return onDemandFrontendsDeferred;
}

export function useOnDemandPluginFrontendsDeferred(): boolean {
  return useSyncExternalStore(
    subscribeDeferred,
    getDeferredSnapshot,
    getDeferredSnapshot,
  );
}
