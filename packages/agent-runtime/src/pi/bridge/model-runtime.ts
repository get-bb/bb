import { ModelRuntime } from "@earendil-works/pi-coding-agent";

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

export function getPiModelRuntime(): Promise<ModelRuntime> {
  // Drop the memo if creation fails, otherwise one transient failure is
  // cached for the life of the process and every later model list and
  // session start replays the same rejection until the bridge restarts.
  modelRuntimePromise ??= ModelRuntime.create().catch((error: unknown) => {
    modelRuntimePromise = undefined;
    throw error;
  });
  return modelRuntimePromise;
}
