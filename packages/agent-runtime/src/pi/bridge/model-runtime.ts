import { ModelRuntime } from "@earendil-works/pi-coding-agent";

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

export function getPiModelRuntime(): Promise<ModelRuntime> {
  modelRuntimePromise ??= ModelRuntime.create();
  return modelRuntimePromise;
}
