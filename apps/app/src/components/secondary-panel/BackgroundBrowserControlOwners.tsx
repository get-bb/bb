import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue } from "jotai";
import type { BrowserTabTarget } from "@bb/server-contract";
import { findPaneByThread } from "@/lib/split-layout";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { useRouteState } from "@/hooks/useRouteState";
import { useThread } from "@/hooks/queries/thread-queries";
import { useThreadFileTabs } from "./useThreadFileTabs";
import {
  registerBrowserControlOwner,
  registerBrowserThreadOwnerActivator,
  waitForBrowserControlTab,
} from "@/lib/browser-control-client";
import type { BrowserControlOwnerRegistration } from "@/lib/browser-control-client";

const LazyBrowserTabContent = lazy(() =>
  import("./BrowserTabContent").then(({ BrowserTabContent }) => ({
    default: BrowserTabContent,
  })),
);

interface BackgroundBrowserTarget {
  projectId: string;
  threadId: string;
}

function BackgroundThreadBrowserOwner({
  projectId,
  threadId,
}: BackgroundBrowserTarget) {
  const { data: thread } = useThread(threadId);
  const {
    activateTab,
    activeBrowserTab,
    browserTabs,
    closeTab,
    openTab,
    updateBrowserTab,
  } = useThreadFileTabs({
    environmentId: thread?.environmentId,
    panelStateId: threadId,
    projectId,
    storageFiles: undefined,
    syncThreadId: threadId,
    terminalSessions: undefined,
  });
  const openControlledBrowserTab = useCallback(
    async (url: string, options: { signal?: AbortSignal } = {}): Promise<BrowserTabTarget> => {
      options.signal?.throwIfAborted();
      const tab = openTab({ kind: "browser", url });
      if (tab?.kind !== "browser") {
        throw new Error("The background Browser tab could not be created");
      }
      try {
        const target = await waitForBrowserControlTab(tab.id, options);
        options.signal?.throwIfAborted();
        return target;
      } catch (error) {
        closeTab(tab.id);
        throw error;
      }
    },
    [closeTab, openTab],
  );
  const activateControlledBrowserTab = useCallback(
    async (tabId: string, options: { signal?: AbortSignal } = {}): Promise<BrowserTabTarget> => {
      options.signal?.throwIfAborted();
      activateTab(tabId);
      return waitForBrowserControlTab(tabId, options);
    },
    [activateTab],
  );
  const ownerRegistrationRef = useRef<BrowserControlOwnerRegistration | null>(
    null,
  );
  const browserTabsRef = useRef(browserTabs);
  browserTabsRef.current = browserTabs;

  useEffect(() => {
    if (thread === undefined || !isDesktopBrowserAvailable()) return;
    const registration = registerBrowserControlOwner({
      active: false,
      activateTab: activateControlledBrowserTab,
      closeTab,
      openTab: openControlledBrowserTab,
      ownerId: `background-thread:${threadId}`,
      projectId,
      tabs: browserTabsRef.current.map(({ id, title, url }) => ({
        tabId: id,
        title,
        url,
      })),
      threadId,
    });
    ownerRegistrationRef.current = registration;
    return () => {
      if (ownerRegistrationRef.current === registration) {
        ownerRegistrationRef.current = null;
      }
      registration.dispose();
    };
  }, [
    activateControlledBrowserTab,
    closeTab,
    openControlledBrowserTab,
    projectId,
    thread,
    threadId,
  ]);

  useEffect(() => {
    ownerRegistrationRef.current?.updateTabs(
      browserTabs.map(({ id, title, url }) => ({ tabId: id, title, url })),
    );
  }, [browserTabs]);

  if (thread === undefined || activeBrowserTab === null) return null;
  return (
    <div
      aria-hidden
      style={{
        height: 720,
        left: 0,
        pointerEvents: "none",
        position: "fixed",
        top: 0,
        visibility: "hidden",
        width: 1280,
      }}
    >
      <Suspense fallback={null}>
        <LazyBrowserTabContent
          key={activeBrowserTab.id}
          addressFocusRequest={null}
          canHandleBrowserCommands={false}
          canShowNativeBrowserView={false}
          environmentId={thread.environmentId}
          initialUrl={activeBrowserTab.url}
          onControlCloseTab={() => closeTab(activeBrowserTab.id)}
          onControlOpenTab={openControlledBrowserTab}
          onUpdate={updateBrowserTab}
          projectId={projectId}
          tabId={activeBrowserTab.id}
          threadId={threadId}
          visibilityCoordinator={null}
        />
      </Suspense>
    </div>
  );
}

export function BackgroundBrowserControlOwners() {
  const layout = useAtomValue(splitLayoutAtom);
  const route = useRouteState();
  const [targets, setTargets] = useState<readonly BackgroundBrowserTarget[]>(
    [],
  );

  useEffect(() => {
    if (!isDesktopBrowserAvailable()) return;
    const registration = registerBrowserThreadOwnerActivator({
      async activate(target) {
        if (target.signal.aborted) {
          throw new DOMException(
            "Browser tab creation was cancelled",
            "AbortError",
          );
        }
        setTargets((current) =>
          current.some(
            (candidate) =>
              candidate.threadId === target.threadId &&
              candidate.projectId === target.projectId,
          )
            ? current
            : [
                ...current,
                { threadId: target.threadId, projectId: target.projectId },
              ],
        );
      },
    });
    return () => registration.dispose();
  }, []);

  const backgroundTargets = useMemo(
    () =>
      targets.filter((target) => {
        if (
          route.threadId === target.threadId &&
          route.projectId === target.projectId
        ) {
          return false;
        }
        return (
          layout === null ||
          findPaneByThread(layout.root, target.projectId, target.threadId) ===
            null
        );
      }),
    [layout, route.projectId, route.threadId, targets],
  );

  return backgroundTargets.map((target) => (
    <BackgroundThreadBrowserOwner
      key={`${target.projectId}:${target.threadId}`}
      {...target}
    />
  ));
}
