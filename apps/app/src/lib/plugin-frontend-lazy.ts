/**
 * The boot-path-safe door into `plugin-frontend`.
 *
 * `plugin-frontend` holds the plugin runtime shim (plugin design §5.1): it
 * imports every library a plugin may resolve at runtime — React, the portal
 * Radix families, sonner, vaul, `@pierre/diffs` (and Shiki behind it) — plus
 * `plugin-sdk-app-impl`, which reaches the promptbox editor and the markdown
 * renderer. Statically importing it from `App` put roughly 1.9 MB of
 * JavaScript in front of first paint even when the page had no plugins.
 *
 * Nothing here may import `plugin-frontend` statically. Routes that render
 * plugin management UI are already lazy and import it directly; they share
 * this module instance, so the reconcile state stays single-owner.
 */
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
} from "./plugin-frontend-boot-state";

type PluginFrontendModule = typeof import("./plugin-frontend");

/**
 * Caches a module import, but drops the cache when the import rejects.
 *
 * A chunk fetch fails on a flaky network. Caching the rejected promise would
 * replay that one failure for the rest of the page's life, so plugin UI could
 * never come back without a reload.
 */
export function createRetryingModuleLoader<T>(
  load: () => Promise<T>,
): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

const loadPluginFrontend = createRetryingModuleLoader<PluginFrontendModule>(
  () => import("./plugin-frontend"),
);

let bootRequested = false;

/**
 * Loads the plugin runtime chunk, then boots the plugin frontends.
 *
 * Matches `bootPluginFrontends`' own contract that a plugin failure leaves the
 * app unharmed. The chunk fetch is the one step that module cannot guard for
 * itself, and callers boot this from an effect without awaiting it, so an
 * escaping rejection would surface as an unhandled one.
 */
export async function bootPluginFrontends(): Promise<void> {
  bootRequested = true;
  // An in-flight boot owns its own settle; the settle floor must not finish
  // it while content scripts are still mounting.
  markPluginFrontendBootStarted();
  try {
    const pluginFrontend = await loadPluginFrontend();
    await pluginFrontend.bootPluginFrontends();
  } catch (error) {
    console.warn(
      `plugin runtime load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    // Either way the registrations are as complete as this load will make
    // them; routes waiting on a plugin may now report it missing.
    markPluginFrontendsSettled();
  }
}

/**
 * Realtime `plugins-changed` hook. Broadcasts arrive on every page, so the
 * guard keeps the first one from pulling the runtime chunk onto the critical
 * path before anything asked for plugins.
 */
export function schedulePluginFrontendReconcile(): void {
  if (!bootRequested) return;
  void (async () => {
    try {
      const pluginFrontend = await loadPluginFrontend();
      // If the chunk fetch failed during boot then plugin-frontend never
      // booted, and its own reconcile guard would no-op forever. Booting here
      // recovers from that; it costs nothing once booted, because
      // bootPluginFrontends is idempotent per page load.
      await pluginFrontend.bootPluginFrontends();
      pluginFrontend.schedulePluginFrontendReconcile();
    } catch {
      // Plugin UI stays absent until the next plugins-changed broadcast.
    }
  })();
}
