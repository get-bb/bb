import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BridgeProcessArgs = string[];

/** The bootstrap bundle's name inside a packaged daemon's bridge bundle dir. */
const BRIDGE_WORKER_BUNDLE_FILE_NAME = "bb-provider-bridge-worker.mjs";

function resolveTsxLoaderSpecifier(): string {
  return import.meta.resolve("tsx");
}

function sourceTypeScriptCandidate(sourceJavaScriptPath: string): string {
  return sourceJavaScriptPath.replace(/\.js$/u, ".ts");
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

export interface ResolveBundledBridgeModuleArgs {
  importMetaUrl: string;
  bridgeRelativePath: string;
  bridgeBundleDir?: string;
  bundleFileName?: string;
}

/**
 * Where a daemon-bundled bridge module lives: inside a packaged daemon's
 * bundle directory, or beside the runtime's own sources. The bootstrap imports
 * this path; it never executes it directly.
 */
export function resolveBundledBridgeModulePath(
  args: ResolveBundledBridgeModuleArgs,
): string {
  if (args.bridgeBundleDir && args.bundleFileName) {
    return resolve(args.bridgeBundleDir, args.bundleFileName);
  }

  const moduleDir = dirname(fileURLToPath(args.importMetaUrl));
  const sourceCandidate = resolve(moduleDir, args.bridgeRelativePath);
  if (existsSync(sourceCandidate)) {
    return sourceCandidate;
  }

  const sourceTsCandidate = sourceTypeScriptCandidate(sourceCandidate);
  if (existsSync(sourceTsCandidate)) {
    return sourceTsCandidate;
  }

  throw new Error(
    `Missing provider bridge. Expected source bridge at ${sourceTsCandidate}` +
      (args.bridgeBundleDir && args.bundleFileName
        ? ` or bundled bridge at ${resolve(args.bridgeBundleDir, args.bundleFileName)}`
        : ""),
  );
}
