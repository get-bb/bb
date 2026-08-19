/**
 * When to start loading plugin frontends (plugin design §5.1).
 *
 * Every running plugin ships its own bundle (several MB unminified across the
 * default set) plus a stylesheet. Booting them the moment `/system/config`
 * resolves put all of that parse/eval and style work into the window in which
 * the route chunk was still downloading — on a phone, the most contended
 * window of the whole page load. This scheduler starts boot after the first
 * route content has painted and the main thread is idle, with a hard timeout
 * so plugins never wait on a route that does not resolve.
 *
 * Plugin panel routes (`/plugins/:pluginId/...`) skip the wait: the plugin
 * bundle *is* the page there, and the reconcile pass loads that plugin first.
 */

export interface PluginFrontendBootScheduleDeps {
  /** Resolves when the first route content has committed. */
  whenRoutePainted: () => Promise<void>;
  /** Run `callback` when the main thread is idle; returns a cancel. */
  requestIdle: (callback: () => void) => () => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  /** Upper bound on the wait, measured from `schedule()`. */
  timeoutMs: number;
}

export const PLUGIN_FRONTEND_BOOT_TIMEOUT_MS = 1_500;

/**
 * Start `boot` once: after route paint + idle, or at `timeoutMs`, whichever
 * comes first. Returns a cancel for the pending wait; a boot that already
 * started is not undone (boot is idempotent per page load).
 */
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

/**
 * Browser idle primitive: `requestIdleCallback` where it exists (with a
 * timeout so a busy main thread cannot starve it), else two animation frames
 * (WebKit ships no requestIdleCallback), which lands after the route's first
 * paint has flushed. Neither fires while the tab is hidden; the boot timeout
 * covers that.
 */
export function requestBrowserIdle(callback: () => void): () => void {
  // lib.dom declares these unconditionally; WebKit still lacks them.
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
