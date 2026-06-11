// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ChangedMessage, ThreadWithRuntime } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type {
  BbDesktopBrowserApi,
  BbDesktopInfo,
} from "@bb/server-contract";
import {
  registerBrowserView,
  resetBrowserViewPersistence,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { collapsedProjectIdsAtom } from "@/components/sidebar/sidebarCollapsedAtoms";
import { createAppQueryClient } from "@/lib/query-client";
import {
  getLegacyProjectComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { threadQueryKey } from "../queries/query-keys";
import {
  useDeletedResourceRouteOwner,
  type DeletedResourceRouteChangeHandler,
} from "./resource-route-owner";

interface RenderRouteOwnerOptions {
  initialEntry: string;
  jotaiStore?: ReturnType<typeof createStore>;
}

interface RenderRouteOwnerResult {
  handleChanged: () => DeletedResourceRouteChangeHandler;
  queryClient: ReturnType<typeof createAppQueryClient>;
}

interface RecordedBrowserCall {
  method: "detach" | "setVisible";
  tabId: string;
  visible: boolean | null;
}

const DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.1",
};

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_1",
    id: "thr_1",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_1",
    providerId: "provider_1",
    stopRequestedAt: null,
    status: "idle",
    title: "Thread",
    titleFallback: "Thread",
    updatedAt: 1,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function installRecordingDesktopBrowser(): RecordedBrowserCall[] {
  const calls: RecordedBrowserCall[] = [];
  const browser: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    detach(tabId) {
      calls.push({ method: "detach", tabId, visible: null });
    },
    setVisible(request) {
      calls.push({
        method: "setVisible",
        tabId: request.tabId,
        visible: request.visible,
      });
    },
  };
  window.bbDesktop = createBbDesktopApi(DESKTOP_INFO, browser);
  return calls;
}

function RouteProbe() {
  const location = useLocation();
  const [rootComposeProjectId] = useRootComposeProjectId();
  return (
    <>
      <span data-testid="location">{location.pathname}</span>
      <span data-testid="root-compose-project-id">{rootComposeProjectId}</span>
    </>
  );
}

function HandlerProbe({
  onReady,
}: {
  onReady: (handler: DeletedResourceRouteChangeHandler) => void;
}) {
  const handler = useDeletedResourceRouteOwner();
  onReady(handler);
  return <RouteProbe />;
}

function renderRouteOwner({
  initialEntry,
  jotaiStore,
}: RenderRouteOwnerOptions): RenderRouteOwnerResult {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  let handler: DeletedResourceRouteChangeHandler | null = null;
  render(
    <JotaiProvider store={jotaiStore}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <HandlerProbe
            onReady={(nextHandler) => {
              handler = nextHandler;
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
  return {
    handleChanged: () => {
      if (!handler) {
        throw new Error("Route owner handler was not captured.");
      }
      return handler;
    },
    queryClient,
  };
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  resetBrowserViewPersistence();
});

describe("useDeletedResourceRouteOwner", () => {
  it("routes a remotely deleted active thread to root compose with its project selected", async () => {
    const thread = makeThread();
    const { handleChanged, queryClient } = renderRouteOwner({
      initialEntry: getThreadRoutePath({
        projectId: thread.projectId,
        threadId: thread.id,
      }),
    });
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
    const message: ChangedMessage = {
      type: "changed",
      entity: "thread",
      id: thread.id,
      changes: ["thread-deleted"],
    };

    act(() => {
      handleChanged()(message);
    });

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
    expect(screen.getByTestId("root-compose-project-id").textContent).toBe(
      thread.projectId,
    );
  });

  it("does not route away when a different thread is deleted remotely", () => {
    const activeThread = makeThread({ id: "thr_2" });
    const deletedThread = makeThread({ id: "thr_1" });
    const { handleChanged, queryClient } = renderRouteOwner({
      initialEntry: getThreadRoutePath({
        projectId: activeThread.projectId,
        threadId: activeThread.id,
      }),
    });
    queryClient.setQueryData(threadQueryKey(deletedThread.id), deletedThread);
    const message: ChangedMessage = {
      type: "changed",
      entity: "thread",
      id: deletedThread.id,
      changes: ["thread-deleted"],
    };

    act(() => {
      handleChanged()(message);
    });

    expect(screen.getByTestId("location").textContent).toBe(
      getThreadRoutePath({
        projectId: activeThread.projectId,
        threadId: activeThread.id,
      }),
    );
  });

  it("routes a remotely deleted active project to root and clears collapsed state", async () => {
    const deletedProjectId = "proj_1";
    const otherProjectId = "proj_2";
    const jotaiStore = createStore();
    jotaiStore.set(collapsedProjectIdsAtom, [deletedProjectId, otherProjectId]);
    const { handleChanged } = renderRouteOwner({
      initialEntry: getLegacyProjectComposeRoutePath(deletedProjectId),
      jotaiStore,
    });
    const message: ChangedMessage = {
      type: "changed",
      entity: "project",
      id: deletedProjectId,
      changes: ["project-deleted"],
    };

    act(() => {
      handleChanged()(message);
    });

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
    expect(jotaiStore.get(collapsedProjectIdsAtom)).toEqual([otherProjectId]);
  });

  it("does not route away when a different project is deleted remotely", () => {
    const deletedProjectId = "proj_1";
    const activeProjectId = "proj_2";
    const jotaiStore = createStore();
    jotaiStore.set(collapsedProjectIdsAtom, [
      deletedProjectId,
      activeProjectId,
    ]);
    const { handleChanged } = renderRouteOwner({
      initialEntry: getLegacyProjectComposeRoutePath(activeProjectId),
      jotaiStore,
    });
    const message: ChangedMessage = {
      type: "changed",
      entity: "project",
      id: deletedProjectId,
      changes: ["project-deleted"],
    };

    act(() => {
      handleChanged()(message);
    });

    expect(screen.getByTestId("location").textContent).toBe(
      getLegacyProjectComposeRoutePath(activeProjectId),
    );
    expect(jotaiStore.get(collapsedProjectIdsAtom)).toEqual([activeProjectId]);
  });

  it("releases retained browser views when an environment is deleted remotely", () => {
    const calls = installRecordingDesktopBrowser();
    registerBrowserView({
      environmentId: "env_deleted",
      tabId: "browser:deleted-environment",
      threadId: "thr_deleted_environment",
    });
    registerBrowserView({
      environmentId: "env_other",
      tabId: "browser:other-environment",
      threadId: "thr_other_environment",
    });
    const activeProjectRoute = getLegacyProjectComposeRoutePath("proj_1");
    const { handleChanged } = renderRouteOwner({
      initialEntry: activeProjectRoute,
    });
    const message: ChangedMessage = {
      type: "changed",
      entity: "environment",
      id: "env_deleted",
      changes: ["environment-deleted"],
    };

    act(() => {
      handleChanged()(message);
    });

    expect(calls).toEqual([
      {
        method: "setVisible",
        tabId: "browser:deleted-environment",
        visible: false,
      },
      {
        method: "detach",
        tabId: "browser:deleted-environment",
        visible: null,
      },
    ]);
    expect(screen.getByTestId("location").textContent).toBe(
      activeProjectRoute,
    );
  });
});
