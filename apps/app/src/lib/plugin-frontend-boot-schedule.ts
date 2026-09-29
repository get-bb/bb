interface PluginFrontendBootScheduleDeps {
  whenRoutePainted: () => Promise<void>;
  requestIdle: (callback: () => void) => () => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  timeoutMs: number;
}

export const PLUGIN_FRONTEND_BOOT_TIMEOUT_MS = 1_500;

export function scheduleDeferredPluginFrontendBoot(
  boot: () => void,
  deps: PluginFrontendBootScheduleDeps,
): () => void {
  let settled = false;
  let cancelIdle: (() => void) | null = null;
  let timeoutId: number | null = null;
  const stopWaiting = () => {
    settled = true;
    if (timeoutId !== null) deps.clearTimeout(timeoutId);
    timeoutId = null;
    cancelIdle?.();
    cancelIdle = null;
  };
  const fire = () => {
    if (settled) return;
    stopWaiting();
    boot();
  };
  void deps.whenRoutePainted().then(() => {
    if (settled) return;
    timeoutId = deps.setTimeout(fire, deps.timeoutMs);
    cancelIdle = deps.requestIdle(fire);
  });
  return () => {
    if (settled) return;
    stopWaiting();
  };
}

export function requestBrowserIdle(callback: () => void): () => void {
  if (
    typeof window.requestIdleCallback === "function" &&
    typeof window.cancelIdleCallback === "function"
  ) {
    const id = window.requestIdleCallback(callback, { timeout: 1_000 });
    return () => window.cancelIdleCallback(id);
  }
  let frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(callback);
  });
  return () => window.cancelAnimationFrame(frame);
}
