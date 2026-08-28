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
  const fire = () => {
    if (settled) return;
    settled = true;
    deps.clearTimeout(timeoutId);
    cancelIdle?.();
    cancelIdle = null;
    boot();
  };
  const timeoutId = deps.setTimeout(fire, deps.timeoutMs);
  void deps.whenRoutePainted().then(() => {
    if (settled) return;
    cancelIdle = deps.requestIdle(fire);
  });
  return () => {
    if (settled) return;
    settled = true;
    deps.clearTimeout(timeoutId);
    cancelIdle?.();
    cancelIdle = null;
  };
}

export function requestBrowserIdle(callback: () => void): () => void {
  const browserWindow = globalThis.window;
  const requestIdleCallback = browserWindow?.requestIdleCallback;
  const cancelIdleCallback = browserWindow?.cancelIdleCallback;
  if (requestIdleCallback !== undefined && cancelIdleCallback !== undefined) {
    const id = requestIdleCallback.call(browserWindow, callback, {
      timeout: 1_000,
    });
    return () => cancelIdleCallback.call(browserWindow, id);
  }
  let frame = browserWindow.requestAnimationFrame(() => {
    frame = browserWindow.requestAnimationFrame(callback);
  });
  return () => browserWindow.cancelAnimationFrame(frame);
}
