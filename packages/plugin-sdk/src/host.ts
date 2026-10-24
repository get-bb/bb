export {
  experimental_defineHostEntry,
  type ExperimentalHostEntry,
  type ExperimentalHostPaths,
  type ExperimentalHostRpcContext,
  type ExperimentalHostRpcHandlers,
  type ExperimentalHostSignalContract,
  type ExperimentalHostSignals,
  type ExperimentalHostWatchChange,
  type ExperimentalHostWatchChangeType,
  type ExperimentalHostWatchEvent,
  type ExperimentalHostWatchListener,
  type ExperimentalHostWatchOptions,
  type ExperimentalHostWatchSubscription,
  type ExperimentalHostWorkerLease,
} from "./host-contract.js";
export {
  experimental_filterResolvedNativeRoots,
  experimental_nativeRootsHostContract,
  experimental_nativeRootsResolveInputSchema,
  experimental_nativeRootsResolveOutputSchema,
  type ExperimentalDroppedNativeRoot,
  type ExperimentalFilteredNativeRoots,
  type ExperimentalNativeRootsHostContract,
  type ExperimentalNativeRootsResolveAnswer,
  type ExperimentalNativeRootsResolveInput,
  type ExperimentalNativeRootsResolveOutput,
} from "./native-roots-contract.js";
export {
  experimental_resolveClaudePluginRoots,
  experimental_resolveVendorPluginRoots,
  type ExperimentalClaudePluginRoots,
  type ExperimentalClaudePluginRootsArgs,
  type ExperimentalVendorPlugin,
  type ExperimentalVendorPluginRoots,
  type ExperimentalVendorPluginRootsArgs,
} from "./vendor-plugin-roots.js";

export { experimental_killProcessesWithCwdUnder } from "./kill-processes.js";

export {
  experimental_readProcessIdentity,
  type ExperimentalProcessIdentity,
} from "./process-identity.js";

/**
 * Spawns output-only child processes with a sanitized inherited environment
 * for host-local plugin operations such as git.
 * Experimental: see docs/api_to_audit.md.
 */
export {
  sanitizeInheritedChildProcessEnv as experimental_sanitizeInheritedChildProcessEnv,
  spawnPortableOutputProcess as experimental_spawnPortableOutputProcess,
} from "@bb/process-utils";
export type { SanitizeInheritedChildProcessEnvArgs as ExperimentalSanitizeInheritedChildProcessEnvArgs } from "@bb/process-utils";

export { runVcsProcess as experimental_runVcsProcess } from "@bb/process-utils";

/**
 * Daemon-grade process primitives for bb's first-party Git plugin host. Not
 * public API: see docs/api_to_audit.md.
 */
export {
  execPortableFile as internal_DO_NOT_USE_execPortableFile,
  spawnManagedProcess as internal_DO_NOT_USE_spawnManagedProcess,
  withVcsProcessPriority as internal_DO_NOT_USE_withVcsProcessPriority,
} from "@bb/process-utils";
export type {
  VcsProcessOptions as ExperimentalVcsProcessOptions,
  VcsProcessPriority as ExperimentalVcsProcessPriority,
} from "@bb/process-utils";
