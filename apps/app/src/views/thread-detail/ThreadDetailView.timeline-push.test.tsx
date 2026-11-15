// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { makeEnvironment } from "@bb/test-helpers/domain-fixtures";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import {
  makeThreadResponse,
  makeThreadTimelineResponse,
} from "@/test/fixtures/thread-responses";
import { DefaultPaneContextProvider } from "./PaneContext";
import { ThreadDetailView } from "./ThreadDetailView";

const threadScreenRenders = vi.hoisted(() => ({ count: 0 }));

const THREAD = makeThreadResponse({
  id: "thr_push",
  projectId: "proj_push",
  environmentId: "env_push",
});
const ENVIRONMENT = makeEnvironment({ id: "env_push", projectId: "proj_push" });

vi.mock("./ThreadScreen", async (importOriginal) => {
  const { useThreadTimeline } =
    await import("@/hooks/queries/thread-panel-queries");
  function TimelineProbe({ threadId }: { threadId: string }) {
    const rowCount = useThreadTimeline(threadId, { enabled: false }).data?.rows
      .length;
    return <div data-testid="timeline-probe">{rowCount ?? 0} rows</div>;
  }
  return {
    ...(await importOriginal<typeof import("./ThreadScreen")>()),
    ThreadScreen: ({ thread }: { thread: { id: string } }) => {
      threadScreenRenders.count += 1;
      return <TimelineProbe threadId={thread.id} />;
    },
  };
});
vi.mock("./ThreadDetailSecondaryContent", () => ({
  ThreadDetailSecondaryContent: ({ main }: { main: ReactNode }) => (
    <div>{main}</div>
  ),
}));
vi.mock("./ThreadDetailHeader", () => ({
  ThreadDetailHeader: () => <header />,
}));
vi.mock("./useThreadDetailThread", () => ({
  useThreadDetailThread: () => ({
    hasThreadDetailBootstrapSettled: true,
    threadDetailBootstrapQuery: { isFetching: false },
    threadQuery: {
      data: THREAD,
      isFetching: false,
      isLoadingError: false,
      error: null,
    },
    unreadDividerState: { ready: true, anchor: null },
  }),
}));
vi.mock("@/hooks/queries/environment-queries", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/environment-queries")
  >()),
  useEnvironment: () => ({
    data: ENVIRONMENT,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

beforeEach(() => {
  notifyManager.setScheduler((notify) => notify());
});

afterEach(() => {
  cleanup();
  notifyManager.setScheduler(defaultScheduler);
  threadScreenRenders.count = 0;
});

function timelineWith(texts: readonly string[]) {
  return makeThreadTimelineResponse({
    maxSeq: texts.length,
    rows: texts.map((text, index) =>
      conversationRow({
        id: `message_${index}`,
        role: "assistant",
        text,
        sourceSeqStart: index + 1,
        sourceSeqEnd: index + 1,
        threadId: THREAD.id,
      }),
    ),
  });
}

describe("ThreadDetailView timeline pushes", () => {
  it("leaves the thread view to the timeline when a push lands", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      threadTimelineQueryKey(THREAD.id),
      timelineWith(["First answer."]),
    );
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <DefaultPaneContextProvider
              paneId="main"
              onRequestClose={null}
              navigateInPane={() => {}}
            >
              <ThreadDetailView
                surface="pane"
                projectId={THREAD.projectId}
                threadId={THREAD.id}
                timelineEnabled={false}
              />
            </DefaultPaneContextProvider>
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <Provider>
          <RouterProvider router={router} />
        </Provider>
      </QueryClientProvider>,
    );
    await screen.findByText("1 rows");
    const rendersBeforePush = threadScreenRenders.count;

    act(() => {
      queryClient.setQueryData(
        threadTimelineQueryKey(THREAD.id),
        timelineWith(["First answer.", "Second answer."]),
      );
    });

    expect(screen.getByText("2 rows")).toBeDefined();
    expect(threadScreenRenders.count).toBe(rendersBeforePush);
  });
});
