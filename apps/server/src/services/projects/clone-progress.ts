import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";

export function createCloneProgressReporter(
  target: PluginEnvironmentProviderProgress,
) {
  let pending: string | null = null;
  let lastText: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEmittedAt = Number.NEGATIVE_INFINITY;
  let disposed = false;

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending === null) return;
    const text = pending;
    pending = null;
    if (text === lastText) return;
    lastText = text;
    lastEmittedAt = Date.now();
    target.log(text);
  }

  function log(text: string) {
    if (disposed) return;
    pending = text;
    const delay = Math.max(0, 1_000 - (Date.now() - lastEmittedAt));
    if (delay === 0) flush();
    else if (timer === null) {
      timer = setTimeout(flush, delay);
      timer.unref();
    }
  }

  return {
    report: { log, step: log } satisfies PluginEnvironmentProviderProgress,
    dispose() {
      disposed = true;
      flush();
    },
  };
}
