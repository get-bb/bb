/**
 * Plain default values that are still shared across source tooling and
 * runtime config validation.
 *
 * Zero runtime dependencies — safe to import from config consumers and
 * tooling entrypoints that only need the raw values.
 */
export const DEFAULTS = {
  logLevel: { prod: "info", dev: "debug" },
  secretToken: { dev: "dev-secret" },
  inferenceModel: "codex/gpt-5.4-mini",
  transcriptionModel: "codex/gpt-4o-mini-transcribe",
  /** Server: max workflow runs concurrently holding one host's capacity. */
  workflowMaxConcurrentRunsPerHost: 4,
  /** Daemon: max live workflow provider processes (the worktree-runtime token gate). */
  workflowMaxLiveProviderProcesses: 8,
} as const;
