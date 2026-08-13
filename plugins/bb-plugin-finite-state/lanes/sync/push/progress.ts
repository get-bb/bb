import type { PushDeps, PushProgress } from "./types.js";

/** Publishes a tiny global-fanout hint; SQLite remains the result data plane. */
export function publishPushProgress(deps: PushDeps, progress: PushProgress): void {
  try {
    deps.publishPush?.(progress);
  } catch {
    // Fanout is an observational hint. It must never make a confirmed remote
    // write ambiguous or prevent the journal/base transaction from advancing.
  }
}
