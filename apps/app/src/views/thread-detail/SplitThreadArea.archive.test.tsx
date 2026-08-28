// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { useContext } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as appCommandProvider from "@/components/commands/AppCommandProvider";
import * as realtime from "@/hooks/useRealtimeSubscription";
import * as sdkModule from "@/lib/sdk";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";
import { PaneContext } from "./PaneContext";
import { SplitThreadArea } from "./SplitThreadArea";
import * as threadDetailViewModule from "./ThreadDetailView";

const ARCHIVED_AT = 1_700_000_000_000;

interface SeedThread {
  id: string;
  archivedAt: number | null;
  deletedAt: number | null;
}

let pendingArchive: {
  promise: Promise<void>;
  resolve: () => void;
  reject: (cause: Error) => void;
} | null = null;

function deferArchive() {
  let resolve!: () => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = (cause) => rej(cause);
  });
  pendingArchive = { promise, resolve, reject };
}

vi.spyOn(realtime, "useThreadDetailRealtimeSubscription").mockImplementation(
  () => undefined,
);
vi.spyOn(realtime, "useThreadListRealtimeSubscription").mockImplementation(
  () => undefined,
);
vi.spyOn(sdkModule.sdk.threads, "get").mockImplementation(
  () => new Promise<never>(() => {}),
);
vi.spyOn(appCommandProvider, "useAppCommandContext").mockImplementation(
  () => undefined,
);
vi.spyOn(appCommandProvider, "useAppCommandHandler").mockImplementation(
  () => undefined,
);
vi.spyOn(appCommandProvider, "useIndexedAppCommandHandlers").mockImplementation(
  () => undefined,
);
vi.spyOn(appCommandProvider, "useAppCommandShortcut").mockImplementation(
  () => null,
);
vi.spyOn(appCommandProvider, "useIsAppCommandModifierHeld").mockImplementation(
  () => false,
);
vi.spyOn(threadDetailViewModule, "ThreadDetailView").mockImplementation(
  (props) => {
    if (props.surface !== "pane") {
      return <div />;
    }
    const pane = useContext(PaneContext);
    return (
      <div
        data-testid={`pane-${props.threadId}`}
        data-focused={pane?.isFocused ? "true" : "false"}
      />
    );
  },
);

function ArchiveHarness({ threadId }: { threadId: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    meta: { lifecycleOperation: "archive_thread" },
    mutationFn: () => pendingArchive!.promise,
    onMutate: () => {
      const previous = queryClient.getQueryData<SeedThread>(
        threadQueryKey(threadId),
      );
      queryClient.setQueryData<SeedThread>(
        threadQueryKey(threadId),
        (thread) => (thread ? { ...thread, archivedAt: ARCHIVED_AT } : thread),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData<SeedThread | undefined>(
        threadQueryKey(threadId),
        context?.previous,
      );
    },
  });
  return (
    <button
      type="button"
      data-testid="archive"
      onClick={() => mutation.mutate()}
    >
      archive
    </button>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function twoPaneLayout(focusedPaneId: "pane-1" | "pane-2"): SplitLayout {
  const content = (threadId: string) => ({
    kind: "thread" as const,
    projectId: PERSONAL_PROJECT_ID,
    threadId,
  });
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-1", content: content("thr-a") },
        { type: "pane", paneId: "pane-2", content: content("thr-b") },
      ],
    },
    focusedPaneId,
  };
}

function renderArchiveScenario() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const id of ["thr-a", "thr-b"]) {
    queryClient.setQueryData<SeedThread>(threadQueryKey(id), {
      id,
      archivedAt: null,
      deletedAt: null,
    });
  }
  const store = createStore();
  store.set(splitLayoutAtom, twoPaneLayout("pane-2"));
  render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/threads/thr-b"]}>
          <SplitThreadArea />
          <LocationProbe />
          <ArchiveHarness threadId="thr-b" />
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
  return queryClient;
}

function archivedAtOf(queryClient: QueryClient, threadId: string) {
  return queryClient.getQueryData<SeedThread>(threadQueryKey(threadId))
    ?.archivedAt;
}

afterEach(() => {
  cleanup();
  pendingArchive = null;
  window.localStorage.clear();
});

describe("SplitThreadArea archive pruning", () => {
  it("restores the pane, focus, and URL when a deferred archive is rejected", async () => {
    deferArchive();
    const queryClient = renderArchiveScenario();
    await screen.findByTestId("pane-thr-b");

    fireEvent.click(screen.getByTestId("archive"));
    await waitFor(() =>
      expect(archivedAtOf(queryClient, "thr-b")).toBe(ARCHIVED_AT),
    );

    expect(screen.getByTestId("pane-thr-b")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-b").dataset.focused).toBe("true");
    expect(screen.getByTestId("location").textContent).toBe("/threads/thr-b");

    await act(async () => {
      pendingArchive!.reject(new Error("archive failed"));
      await Promise.resolve();
    });
    await waitFor(() => expect(archivedAtOf(queryClient, "thr-b")).toBeNull());

    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-b")).toBeTruthy();
    expect(screen.getByTestId("pane-thr-b").dataset.focused).toBe("true");
    expect(screen.getByTestId("location").textContent).toBe("/threads/thr-b");
  });

  it("closes the pane and moves the URL to the survivor once the archive is confirmed", async () => {
    deferArchive();
    const queryClient = renderArchiveScenario();
    await screen.findByTestId("pane-thr-b");

    fireEvent.click(screen.getByTestId("archive"));
    await waitFor(() =>
      expect(archivedAtOf(queryClient, "thr-b")).toBe(ARCHIVED_AT),
    );
    expect(screen.getByTestId("pane-thr-b")).toBeTruthy();

    await act(async () => {
      pendingArchive!.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByTestId("pane-thr-b")).toBeNull());
    expect(screen.getByTestId("pane-thr-a")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/threads/thr-a"),
    );
  });
});
