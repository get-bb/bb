import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type BridgeProcessArgs = string[];

/** The bootstrap bundle's name inside a packaged daemon's bridge bundle dir. */
const BRIDGE_WORKER_BUNDLE_FILE_NAME = "bb-provider-bridge-worker.mjs";

function resolveTsxLoaderSpecifier(): string {
  return import.meta.resolve("tsx");
}

function sourceTypeScriptProcessArgs(sourcePath: string): BridgeProcessArgs {
  return [
    "--conditions=source",
    "--import",
    resolveTsxLoaderSpecifier(),
    sourcePath,
  ];
}

/**
 * The node arguments that run the provider-bridge bootstrap, up to and
 * including its entry file. The bridge module path and its plugin scope are
 * appended by the caller.
 *
 * A packaged daemon ships the bootstrap beside its bundled bridges; from
 * source it is the protocol package's TypeScript entry, run through tsx (which
 * also lets the bootstrap dynamically import a TypeScript bridge module).
 */
export function resolveBridgeWorkerProcessArgs(args: {
  bridgeBundleDir?: string;
}): BridgeProcessArgs {
  if (args.bridgeBundleDir) {
    return [resolve(args.bridgeBundleDir, BRIDGE_WORKER_BUNDLE_FILE_NAME)];
  }
  const sourceEntry = fileURLToPath(
    import.meta.resolve("@bb/provider-bridge-protocol/bridge-worker-entry"),
  );
  return sourceEntry.endsWith(".ts")
    ? sourceTypeScriptProcessArgs(sourceEntry)
    : [sourceEntry];
}
