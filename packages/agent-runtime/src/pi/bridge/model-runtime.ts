import { resolve } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createConfiguredPiServices } from "./configured-services.js";

const modelRuntimePromises = new Map<string, Promise<ModelRuntime>>();

export function getPiModelRuntime(cwd = process.cwd()): Promise<ModelRuntime> {
  const resolvedCwd = resolve(cwd);
  const existing = modelRuntimePromises.get(resolvedCwd);
  if (existing) {
    return existing;
  }

  // Use the full service path here too. This adds models from configured Pi
  // extensions to BB's model picker. Cache each requested workspace separately
  // because project settings and extensions are bound to that workspace.
  const modelRuntimePromise = createConfiguredPiServices({ cwd: resolvedCwd })
    .then((services) => services.modelRuntime)
    // Drop the memo if creation fails. A transient failure must not poison all
    // later model-list calls until the bridge restarts.
    .catch((error: unknown) => {
      modelRuntimePromises.delete(resolvedCwd);
      throw error;
    });
  modelRuntimePromises.set(resolvedCwd, modelRuntimePromise);
  return modelRuntimePromise;
}

/** @internal Test seam. */
export function resetPiModelRuntimesForTests(): void {
  modelRuntimePromises.clear();
}
