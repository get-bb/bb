import { createContext, useContext, type ReactNode } from "react";
import type { ExperimentalPluginActionContext } from "@get-bb/plugin-sdk";
import {
  getFocusedAppNavigationSurface,
  type ResolvedAppNavigationHostCapabilities,
} from "@/lib/app-navigation-host";
import { getActiveComposerHandle } from "@/lib/active-composer";
import {
  usePluginActionContextBinder,
  type BindPluginActionContext,
} from "@/lib/plugin-navigation-hooks";
import {
  createPluginPanelController,
  withRetiredPanelAlias,
} from "@/lib/plugin-panel-controller";

function unavailable<T extends object>(pluginId: string, name: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      throw new Error(
        `Plugin ${pluginId} used ${name}.${String(property)} outside PluginActionContextProvider`,
      );
    },
  });
}

function unavailableRequest(
  pluginId: string,
  name: string,
): () => Promise<void> {
  return () =>
    Promise.reject(
      new Error(
        `Plugin ${pluginId} used ${name} outside PluginActionContextProvider`,
      ),
    );
}

export function unavailablePluginActionContext(
  pluginId: string,
): ExperimentalPluginActionContext {
  return {
    sdk: unavailable(pluginId, "sdk"),
    navigate: unavailable(pluginId, "navigate"),
    panel: unavailable(pluginId, "panel"),
    composer: getActiveComposerHandle(pluginId),
    threadRequests: {
      requestArchive: unavailableRequest(
        pluginId,
        "threadRequests.requestArchive",
      ),
      requestDelete: unavailableRequest(
        pluginId,
        "threadRequests.requestDelete",
      ),
    },
  };
}

const bindPanelOnly: BindPluginActionContext = (pluginId, host) =>
  withRetiredPanelAlias({
    ...unavailablePluginActionContext(pluginId),
    panel: createPluginPanelController(pluginId, () => host().panel),
  });

const PluginActionContextBinderContext =
  createContext<BindPluginActionContext>(bindPanelOnly);

export function PluginActionContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const bind = usePluginActionContextBinder();
  return (
    <PluginActionContextBinderContext.Provider value={bind}>
      {children}
    </PluginActionContextBinderContext.Provider>
  );
}

export function useBindPluginActionContext(): BindPluginActionContext {
  return useContext(PluginActionContextBinderContext);
}

export function bindFocusedSurfaceActionContext(
  bind: BindPluginActionContext,
  host: ResolvedAppNavigationHostCapabilities,
): (pluginId: string) => ExperimentalPluginActionContext {
  return (pluginId) =>
    bind(pluginId, () => getFocusedAppNavigationSurface() ?? host);
}
