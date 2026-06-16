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
} as const;
