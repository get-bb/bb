// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { useContext } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  makeThread,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import { afterEach, expect, it, vi } from "vitest";
import {
  sidebarNavigationQueryKey,
  threadQueryKey,
} from "@/hooks/queries/query-keys";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { getThreadRoutePath } from "@/lib/route-paths";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";
import { resetThreadActionRegistryForTest } from "@/lib/thread-actions/thread-action-registry";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "@/components/thread/ThreadActionsProvider";
import { PaneContext } from "./PaneContext";
import { SplitThreadArea } from "./SplitThreadArea";

const ENVIRONMENT_ID = "env_archived";

const archiveThreads = vi.hoisted(() => ({
  resolve: null as null | (() => void),
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: () => undefined,
  useThreadListRealtimeSubscription: () => undefined,
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: {
      archiveThreads: () =>
        new Promise((resolve) => {
          archiveThreads.resolve = () =>
            resolve({ ok: true, archivedThreadIds: ["thr-env"] });
        }),
    },
    threads: {
      get: () => new Promise<never>(() => {}),
      list: () => new Promise<never>(() => {}),
    },
  },
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { confirmThreadArchive: true } },
  }),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: () => undefined,
  useAppCommandShortcut: () => null,
  useIndexedAppCommandHandlers: () => undefined,
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("./ThreadDetailView", () => ({
  ThreadDetailView: ({ threadId }: { threadId: string }) => {
    const pane = useContext(PaneContext);
    return (
      <div
        data-testid={`pane-${threadId}`}
        data-focused={pane?.isFocused ? "true" : "false"}
      />
    );
  },
}));

function threadContent(threadId: string) {
  return { kind: "thread" as const, projectId: PERSONAL_PROJECT_ID, threadId };
}

const LAYOUT: SplitLayout = {
  root: {
    type: "split",
    dir: "row",
    sizes: [0.5, 0.5],
    children: [
      {
        type: "pane",
        paneId: "pane-other",
        content: threadContent("thr-other"),
      },
      { type: "pane", paneId: "pane-env", content: threadContent("thr-env") },
    ],
  },
  focusedPaneId: "pane-env",
};

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function ArchiveEnvironmentButton() {
  const { archiveEnvironmentThreads } = useThreadActions();
  return (
    <button
      type="button"
      onClick={() => void archiveEnvironmentThreads(ENVIRONMENT_ID)}
    >
      Archive environment
    </button>
  );
}

afterEach(() => {
  cleanup();
  resetThreadActionRegistryForTest();
  archiveThreads.resolve = null;
});

it("keeps an unrelated split pane open and focused when an environment is archived", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const envThread = makeThread({
    id: "thr-env",
    projectId: PERSONAL_PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
  });
  const otherThread = makeThread({
    id: "thr-other",
    projectId: PERSONAL_PROJECT_ID,
    environmentId: "env_other",
  });
  for (const thread of [envThread, otherThread]) {
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
  }
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    makeSidebarBootstrapResponse({
      personalProject: makeProjectWithThreadsResponse({
        id: PERSONAL_PROJECT_ID,
        threads: [
          makeThreadListEntry({ ...envThread }),
          makeThreadListEntry({ ...otherThread }),
        ],
      }),
    }),
  );
  const store = createStore();
  store.set(splitLayoutAtom, LAYOUT);
  const unsubscribe = store.sub(splitLayoutAtom, () => {
    const layout = store.get(splitLayoutAtom);
    const envPaneOpen =
      layout !== null && JSON.stringify(layout.root).includes("thr-env");
    if (!envPaneOpen) archiveThreads.resolve?.();
  });
  render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            getThreadRoutePath({
              projectId: PERSONAL_PROJECT_ID,
              threadId: "thr-env",
            }),
          ]}
        >
          <RouteNavigationProvider>
            <ThreadActionsProvider>
              <SplitThreadArea />
              <LocationProbe />
              <ArchiveEnvironmentButton />
            </ThreadActionsProvider>
          </RouteNavigationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Archive environment" }));
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(archiveThreads.resolve).not.toBeNull();
  await act(async () => {
    archiveThreads.resolve?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  unsubscribe();

  expect(screen.queryByTestId("pane-thr-env")).toBeNull();
  expect(screen.getByTestId("pane-thr-other")).not.toBeNull();
  expect(screen.getByTestId("location").textContent).toBe(
    getThreadRoutePath({
      projectId: PERSONAL_PROJECT_ID,
      threadId: "thr-other",
    }),
  );
});
