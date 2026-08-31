import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
} from "./plugin-frontend-boot-state";
import { markEnabledPluginListStale } from "@/hooks/cache-owners/plugin-cache-owner";
import { appQueryClient } from "./app-query-client";

type PluginFrontendModule = typeof import("./plugin-frontend");

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

export async function bootPluginFrontends(): Promise<void> {
  bootRequested = true;
  markPluginFrontendBootStarted();
  try {
    const pluginFrontend = await loadPluginFrontend();
    await pluginFrontend.bootPluginFrontends();
  } catch (error) {
    console.warn(
      `plugin runtime load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    markPluginFrontendsSettled();
  }
}

export function schedulePluginFrontendReconcile(): void {
  if (!bootRequested) return;
  void (async () => {
    try {
      await markEnabledPluginListStale({ queryClient: appQueryClient });
      const pluginFrontend = await loadPluginFrontend();
      await pluginFrontend.bootPluginFrontends();
      pluginFrontend.schedulePluginFrontendReconcile();
    } catch {}
  })();
}
