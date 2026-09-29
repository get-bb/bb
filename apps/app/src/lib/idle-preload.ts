const IDLE_PRELOAD_TIMEOUT_MS = 3000;
const IDLE_PRELOAD_FALLBACK_DELAY_MS = 1500;

function prefersReducedData(navigator: Navigator): boolean {
  const connection: unknown = Reflect.get(navigator, "connection");
  return (
    typeof connection === "object" &&
    connection !== null &&
    "saveData" in connection &&
    connection.saveData === true
  );
}

export function scheduleIdlePreload(preload: () => void): () => void {
  if (prefersReducedData(window.navigator)) {
    return () => {};
  }
  if (typeof window.requestIdleCallback === "function") {
    const idleCallback = window.requestIdleCallback(preload, {
      timeout: IDLE_PRELOAD_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback(idleCallback);
  }
  const timeout = window.setTimeout(preload, IDLE_PRELOAD_FALLBACK_DELAY_MS);
  return () => window.clearTimeout(timeout);
}
