import { useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  matchPath,
  useLocation,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import type {
  BbNavigate,
  ExperimentalPluginActionContext,
  PluginBrowserBbSdk,
} from "@get-bb/plugin-sdk";
import { usePluginId } from "@/components/plugin/plugin-context";
import { BbHttpError, sdk } from "@/lib/sdk";
import { getPluginBoundSdk } from "@/lib/plugin-bound-sdk";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
  getProjectComposeRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  AUTOMATION_EDIT_ROUTE_PATH,
} from "@/lib/route-paths";
import { RouteNavigationCallbackContext } from "@/components/ui/app-route-anchor";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { lookupCachedThread } from "@/lib/cached-thread";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import {
  useAppNavigationHost,
  type ResolvedAppNavigationHostCapabilities,
} from "@/lib/app-navigation-host";
import {
  normalizeExperimentalFileOpenOptions,
  normalizeExperimentalFilePreviewOptions,
} from "@/lib/live-file-navigation";
import {
  createPluginPanelController,
  createRetiredOpenPanel,
  withRetiredPanelAlias,
} from "@/lib/plugin-panel-controller";
import { getActiveComposerHandle } from "@/lib/active-composer";
import { bindThreadRequests } from "@/lib/thread-requests";

export function isAutomationEditRoutePath(pathname: string): boolean {
  return (
    matchPath({ path: AUTOMATION_EDIT_ROUTE_PATH, end: true }, pathname) !==
    null
  );
}

export function useSdk(): PluginBrowserBbSdk {
  const pluginId = usePluginId();
  const queryClient = useQueryClient();
  return getPluginBoundSdk(sdk, pluginId, queryClient);
}

export type BindPluginActionContext = (
  pluginId: string,
  host: () => ResolvedAppNavigationHostCapabilities,
) => ExperimentalPluginActionContext;

interface BbNavigateDeps {
  navigate: NavigateFunction;
  onNavigate: (() => void) | null;
  pathname: string;
  store: ReturnType<typeof useStore>;
  queryClient: QueryClient;
  isCompact: boolean;
  setRootComposeProjectId: (projectId: string) => void;
}

function createBbNavigate(
  pluginId: string,
  host: () => ResolvedAppNavigationHostCapabilities,
  latest: () => BbNavigateDeps,
): BbNavigate & {
  openThreadPanel: ReturnType<typeof createRetiredOpenPanel>;
} {
  return {
    toThread(threadId, options) {
      const { isCompact, navigate, onNavigate, queryClient, store } = latest();
      onNavigate?.();
      const open = (projectId: string) => {
        store.set(getThreadConversationCollapsedAtom(threadId), false);
        if (options?.split) {
          openThreadInSplit({
            store,
            navigate: (route, navigateOptions) => {
              void navigate(route, navigateOptions);
            },
            projectId,
            threadId,
            isCompact,
          });
          return;
        }
        void navigate(getThreadRoutePath({ projectId, threadId }));
      };
      const cached = lookupCachedThread(queryClient, threadId);
      if (cached !== null) {
        open(cached.projectId);
        return;
      }
      void sdk.threads
        .get({ threadId })
        .then((thread) => open(thread.projectId))
        .catch(() => navigate(`/threads/${threadId}`));
    },
    toProject(projectId) {
      const { navigate, onNavigate } = latest();
      onNavigate?.();
      void navigate(getProjectComposeRoutePath(projectId));
    },
    toPluginPanel(path, options) {
      const { navigate, onNavigate } = latest();
      const route = getPluginPanelRoutePath({
        pluginId,
        path,
        ...(options?.subPath !== undefined ? { subPath: options.subPath } : {}),
      });
      onNavigate?.();
      void navigate(route, options?.replace ? { replace: true } : undefined);
    },
    toCompose(options) {
      const { navigate, onNavigate, pathname, setRootComposeProjectId } =
        latest();
      const replacesAutomationEditRoute =
        pluginId === AUTOMATIONS_PLUGIN_ID &&
        isAutomationEditRoutePath(pathname);
      if (options?.projectId !== undefined) {
        setRootComposeProjectId(options.projectId);
      }
      const hostId = options?.hostId?.trim() ?? "";
      onNavigate?.();
      void navigate(getRootComposeRoutePath(), {
        ...(replacesAutomationEditRoute ? { replace: true } : {}),
        state: {
          focusPrompt: options?.focusPrompt ?? false,
          initialPrompt: options?.initialPrompt ?? "",
          ...(options?.placement !== undefined
            ? { placement: options.placement }
            : {}),
          ...(options?.environmentId !== undefined
            ? { reuseEnvironmentId: options.environmentId }
            : {}),
          ...(hostId.length > 0 ? { newEnvironmentHostId: hostId } : {}),
          ...(replacesAutomationEditRoute
            ? { replaceInitialPrompt: true }
            : {}),
        },
      });
    },
    openThreadPanel: createRetiredOpenPanel(
      createPluginPanelController(pluginId, () => host().panel),
    ),
    openUrl: (url) => host().openUrl({ url }),
    experimental_openFilePreview(options) {
      const normalized = normalizeExperimentalFilePreviewOptions(options);
      if (normalized === null) return false;
      return host().openFilePreview(
        normalized.opener === null
          ? normalized.options
          : {
              ...normalized.options,
              viewer: { pluginId, openerId: normalized.opener },
            },
      );
    },
    experimental_openFileExternally(options) {
      const normalized = normalizeExperimentalFileOpenOptions(options);
      return normalized !== null && host().openFileExternally(normalized);
    },
    async experimental_openTerminal({ terminalId }) {
      const session = await sdk.terminals
        .get({ terminalId })
        .catch((error: unknown) => {
          if (error instanceof BbHttpError && error.status === 404) return null;
          throw error;
        });
      return session !== null && host().openTerminal(session);
    },
  };
}

export function usePluginActionContextBinder(): BindPluginActionContext {
  const deps: BbNavigateDeps = {
    navigate: useNavigate(),
    onNavigate: useContext(RouteNavigationCallbackContext),
    pathname: useLocation().pathname,
    store: useStore(),
    queryClient: useQueryClient(),
    isCompact: useIsCompactViewport(),
    setRootComposeProjectId: useSetRootComposeProjectId(),
  };
  const latest = useRef(deps);
  useLayoutEffect(() => {
    latest.current = deps;
  });
  const [bind] = useState(() => {
    const bindContext: BindPluginActionContext = (pluginId, host) =>
      withRetiredPanelAlias({
        sdk: getPluginBoundSdk(sdk, pluginId, latest.current.queryClient),
        navigate: createBbNavigate(pluginId, host, () => latest.current),
        panel: createPluginPanelController(pluginId, () => host().panel),
        composer: getActiveComposerHandle(pluginId),
        threadRequests: bindThreadRequests(() => latest.current.store),
      });
    return bindContext;
  });
  return bind;
}

export function useBbNavigate(): BbNavigate {
  const pluginId = usePluginId();
  const appNavigation = useAppNavigationHost();
  const bind = usePluginActionContextBinder();
  return useMemo(
    () => bind(pluginId, () => appNavigation).navigate,
    [appNavigation, bind, pluginId],
  );
}
