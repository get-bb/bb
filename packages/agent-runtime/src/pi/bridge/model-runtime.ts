import {
  createAgentSessionServices,
  getAgentDir,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

export function getPiModelRuntime(): Promise<ModelRuntime> {
  // Use the full service path here too. This adds models from configured Pi
  // extensions to BB's model picker. The bridge process starts in the current
  // workspace, so the loader also sees that workspace's .pi configuration.
  modelRuntimePromise ??= createAgentSessionServices({
    agentDir: getAgentDir(),
    cwd: process.cwd(),
  })
    .then((services) => {
      const errors = services.diagnostics.filter(
        (diagnostic) => diagnostic.type === "error",
      );
      if (errors.length > 0) {
        throw new Error(errors.map((error) => error.message).join("\n"));
      }
      return services.modelRuntime;
    })
    // Drop the memo if creation fails. A transient failure must not poison all
    // later model-list calls until the bridge restarts.
    .catch((error: unknown) => {
      modelRuntimePromise = undefined;
      throw error;
    });
  return modelRuntimePromise;
}
