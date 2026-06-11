// How the daemon locates the workflow runner child entry: the bundled .mjs
// when the daemon ships bundles (apps/host-daemon/scripts/bundle-manifest.mjs
// builds bb-workflow-runner.mjs from runner-main.ts), else this package's
// TypeScript source under tsx. Same bundle-vs-source fallback as the provider
// bridges (`resolveBridgeProcessArgs` in @bb/agent-runtime), duplicated here
// so @bb/workflow-runtime does not grow a dependency on @bb/agent-runtime.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKFLOW_RUNNER_BUNDLE_FILE_NAME = "bb-workflow-runner.mjs";

export interface ResolveWorkflowRunnerProcessArgsOptions {
  /** The daemon's bundle directory; absent in dev (source fallback via tsx). */
  bundleDir?: string;
}

/** Argv (after `node`) for spawning the workflow runner child process. */
export function resolveWorkflowRunnerProcessArgs(
  options: ResolveWorkflowRunnerProcessArgsOptions,
): string[] {
  if (options.bundleDir) {
    return [resolve(options.bundleDir, WORKFLOW_RUNNER_BUNDLE_FILE_NAME)];
  }
  const sourcePath = fileURLToPath(new URL("runner-main.ts", import.meta.url));
  if (!existsSync(sourcePath)) {
    throw new Error(
      `Missing workflow runner entry. Expected source at ${sourcePath} or a ` +
        `bundled ${WORKFLOW_RUNNER_BUNDLE_FILE_NAME} under a provided bundleDir.`,
    );
  }
  return [
    "--conditions=source",
    "--import",
    import.meta.resolve("tsx"),
    sourcePath,
  ];
}
