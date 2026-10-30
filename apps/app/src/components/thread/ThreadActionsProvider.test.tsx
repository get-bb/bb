// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import type { ThreadCascadeListResponse } from "@bb/server-contract";
import { makeThread as makeThreadFixture } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
} from "@/hooks/queries/query-keys";
import { getCachedSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { appToast } from "@/components/ui/app-toast";
import { sdk } from "@/lib/sdk";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";

const mocks = vi.hoisted(() => ({
  confirmThreadArchive: true as boolean | undefined,
  closePanesForThreads: vi.fn(),
  deleteThread: vi.fn(),
  mutation: vi.fn(),
  navigate: vi.fn(),
  pathname: "/",
  viewedThreadId: undefined as string | undefined,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useLocation: () => ({ hash: "", pathname: mocks.pathname, search: "" }),
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => mocks.navigate,
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return {
    ...actual,
    useSetAtom: () => mocks.closePanesForThreads,
  };
});

vi.mock("@/components/dialogs/ThreadDeleteDialog", () => ({
  ThreadDeleteDialog: ({
    target,
    onDelete,
  }: {
    target: { threads: readonly Thread[]; childThreadCount?: number } | null;
    onDelete: (target: unknown) => void;
  }) =>
    target === null ? null : (
      <div role="alertdialog">
        Delete {target.threads.length} with {target.childThreadCount ?? 0}{" "}
        children
        <button type="button" onClick={() => onDelete(target)}>
          Confirm delete
        </button>
      </div>
    ),
}));

vi.mock("@/components/dialogs/ThreadRenameDialog", () => ({
  ThreadRenameDialog: () => null,
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/mutations/thread-state-mutations", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/hooks/mutations/thread-state-mutations")
    >();
  return {
    ...actual,
    useDeleteThread: () => ({
      isPending: false,
      mutate: mocks.mutation,
      mutateAsync: mocks.deleteThread,
    }),
    useMarkThreadRead: () => ({ mutate: mocks.mutation }),
    useMarkThreadUnread: () => ({ mutate: mocks.mutation }),
    usePinThread: () => ({ mutate: mocks.mutation }),
    useUnpinThread: () => ({ mutate: mocks.mutation }),
    useUpdateThread: () => ({
      isPending: false,
      mutate: mocks.mutation,
      mutateAsync: mocks.mutation,
    }),
  };
});

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { archiveThreads: vi.fn() },
    threads: {
      archiveAll: vi.fn(),
      childSummary: vi.fn(),
      experimental_listCascade: vi.fn(),
      unarchive: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data:
      mocks.confirmThreadArchive === undefined
        ? undefined
        : {
            generalSettings: {
              confirmThreadArchive: mocks.confirmThreadArchive,
            },
          },
  }),
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ threadId: mocks.viewedThreadId }),
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    createdAt: 1,
    id: "thr_parent",
    lastReadAt: null,
    latestAttentionAt: 1,
    title: "Investigate archive behavior",
    titleFallback: null,
    updatedAt: 1,
    ...overrides,
  });
}

function ArchiveButton({ thread }: { thread: Thread }) {
  const { requestArchive } = useThreadActions();
  return (
    <button type="button" onClick={() => requestArchive(thread)}>
      Archive
    </button>
  );
}

function SelectionButtons({ threads }: { threads: readonly Thread[] }) {
  const { requestArchiveThreads, requestDeleteThreads } = useThreadActions();
  return (
    <>
      <button type="button" onClick={() => requestArchiveThreads(threads)}>
        Archive selection
      </button>
      <button type="button" onClick={() => requestDeleteThreads(threads)}>
        Delete selection
      </button>
    </>
  );
}

function mockCascade(cascades: Record<string, string[]>) {
  vi.mocked(sdk.threads.experimental_listCascade).mockImplementation(
    async ({ threadIds }) => ({
      threads: threadIds.map((threadId) => ({
        threadId,
        cascadeThreadIds: cascades[threadId] ?? [],
      })),
    }),
  );
}

function ArchiveEnvironmentButton() {
  const { archiveEnvironmentThreads } = useThreadActions();
  return (
    <button onClick={() => void archiveEnvironmentThreads("env_test")}>
      Archive group
    </button>
  );
}

function renderProvider(children: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>{children}</ThreadActionsProvider>
    </QueryClientProvider>,
  );
}

let queryClient: QueryClient;

beforeEach(() => {
  mocks.confirmThreadArchive = true;
  mocks.pathname = "/";
  mocks.viewedThreadId = undefined;
  queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  vi.mocked(sdk.threads.archiveAll).mockResolvedValue({
    archivedThreadIds: ["thr_child", "thr_parent"],
    ok: true,
  });
  mockCascade({ thr_parent: ["thr_child"] });
  vi.mocked(sdk.threads.unarchive).mockResolvedValue({ ok: true });
  mocks.closePanesForThreads.mockReturnValue({
    focusedRoute: null,
    removedAny: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadActionsProvider archive confirmation", () => {
  it("archives parent and children immediately when confirmation is disabled", async () => {
    mocks.confirmThreadArchive = false;
    renderProvider(<ArchiveButton thread={makeThread()} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await vi.waitFor(() => expect(appToast.success).toHaveBeenCalledTimes(1));
    expect(sdk.threads.archiveAll).toHaveBeenCalledWith({
      threadId: "thr_parent",
    });
    expect(sdk.threads.childSummary).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    const undo = vi.mocked(appToast.success).mock.calls[0]?.[1]?.cancel;
    if (undo === undefined) throw new Error("Expected archive Undo");
    render(<button onClick={undo.onClick}>Undo archive</button>);
    fireEvent.click(screen.getByRole("button", { name: "Undo archive" }));
    await vi.waitFor(() =>
      expect(sdk.threads.unarchive).toHaveBeenCalledTimes(2),
    );
    expect(sdk.threads.unarchive).toHaveBeenNthCalledWith(1, {
      threadId: "thr_parent",
    });
    expect(sdk.threads.unarchive).toHaveBeenNthCalledWith(2, {
      threadId: "thr_child",
    });
  });

  it("keeps confirmation enabled before settings are available", async () => {
    mocks.confirmThreadArchive = undefined;
    renderProvider(<ArchiveButton thread={makeThread()} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await screen.findByRole("button", { name: "Cancel" });
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it.each(["archive", "confirmation", "error", "archive-error"] as const)(
    "keeps the sidebar row during planning and handles %s",
    async (outcome) => {
      let resolveSummary!: (summary: ThreadCascadeListResponse) => void;
      let rejectSummary!: (error: Error) => void;
      vi.mocked(sdk.threads.experimental_listCascade).mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveSummary = resolve;
            rejectSummary = reject;
          }),
      );
      if (outcome === "archive-error") {
        vi.mocked(sdk.threads.archiveAll).mockRejectedValueOnce(
          new Error("Archive failed"),
        );
      }
      const thread = makeThreadListEntry(makeThread());
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        makeSidebarBootstrapResponse({
          projects: [
            makeProjectWithThreadsResponse({
              id: thread.projectId,
              threads: [thread],
            }),
          ],
        }),
      );
      renderProvider(<ArchiveButton thread={thread} />);
      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
      await vi.waitFor(() => {
        expect(sdk.threads.experimental_listCascade).toHaveBeenCalled();
        expect(getCachedSidebarNavigationThreads(queryClient)).toEqual([
          thread,
        ]);
      });
      expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
      if (outcome === "error") {
        rejectSummary(new Error("Could not check children"));
      } else {
        resolveSummary({
          threads: [
            {
              threadId: thread.id,
              cascadeThreadIds: outcome === "confirmation" ? ["thr_child"] : [],
            },
          ],
        });
      }
      if (outcome === "archive") {
        await vi.waitFor(() =>
          expect(sdk.threads.archiveAll).toHaveBeenCalled(),
        );
        expect(getCachedSidebarNavigationThreads(queryClient)).toEqual([]);
      } else {
        if (outcome !== "confirmation") {
          await vi.waitFor(() => expect(appToast.error).toHaveBeenCalled());
        }
        await vi.waitFor(() =>
          expect(getCachedSidebarNavigationThreads(queryClient)).toEqual([
            thread,
          ]),
        );
        if (outcome === "archive-error") {
          expect(sdk.threads.archiveAll).toHaveBeenCalled();
        } else {
          expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
        }
        if (outcome === "confirmation") {
          fireEvent.click(
            await screen.findByRole("button", { name: "Cancel" }),
          );
          expect(getCachedSidebarNavigationThreads(queryClient)).toEqual([
            thread,
          ]);
        } else {
          await vi.waitFor(() => expect(appToast.error).toHaveBeenCalled());
        }
      }
    },
  );

  it("ignores a superseded child check without restoring another archived row", async () => {
    let resolveCascade!: (response: ThreadCascadeListResponse) => void;
    vi.mocked(sdk.threads.experimental_listCascade).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCascade = resolve;
        }),
    );
    const first = makeThreadListEntry(makeThread());
    const second = makeThreadListEntry(makeThread({ id: "thr_second" }));
    const untouched = makeThreadListEntry(makeThread({ id: "thr_untouched" }));
    const listKey = threadListQueryKey({ archived: false });
    queryClient.setQueryData(listKey, [first, second, untouched]);
    vi.mocked(sdk.threads.archiveAll).mockResolvedValueOnce({
      ok: true,
      archivedThreadIds: [second.id],
    });
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarBootstrapResponse({
        projects: [
          makeProjectWithThreadsResponse({
            id: first.projectId,
            threads: [first, second, untouched],
          }),
        ],
      }),
    );
    renderProvider(
      <>
        <ArchiveButton thread={first} />
        <ArchiveButton thread={second} />
      </>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Archive" })[0]!);
    await vi.waitFor(() =>
      expect(sdk.threads.experimental_listCascade).toHaveBeenCalledTimes(1),
    );
    expect(getCachedSidebarNavigationThreads(queryClient)).toEqual([
      first,
      second,
      untouched,
    ]);
    fireEvent.click(screen.getAllByRole("button", { name: "Archive" })[1]!);
    await vi.waitFor(() => expect(appToast.success).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveCascade({
        threads: [{ threadId: first.id, cascadeThreadIds: ["thr_child"] }],
      });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sdk.threads.archiveAll).toHaveBeenCalledExactlyOnceWith({
      threadId: second.id,
    });
    expect(getCachedSidebarNavigationThreads(queryClient)).toEqual([
      first,
      untouched,
    ]);
    expect(queryClient.getQueryData(listKey)).toEqual([first, untouched]);
  });

  it("archives without confirmation when its only child is already archived", async () => {
    mockCascade({});
    vi.mocked(sdk.threads.archiveAll).mockResolvedValue({
      archivedThreadIds: ["thr_parent"],
      ok: true,
    });
    renderProvider(<ArchiveButton thread={makeThread()} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await vi.waitFor(() => {
      expect(sdk.threads.archiveAll).toHaveBeenCalledWith({
        threadId: "thr_parent",
      });
    });
    expect(
      screen.queryByRole("heading", { name: /Archive \d+ threads\?/ }),
    ).toBeNull();
  });

  it("reports child threads and archives nothing before confirmation", async () => {
    mockCascade({
      thr_parent: ["thr_child1", "thr_child2", "thr_child3", "thr_child4"],
    });
    renderProvider(<ArchiveButton thread={makeThread()} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect((await screen.findByRole("dialog")).textContent).toContain(
      "Its 4 child threads will be archived too.",
    );
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it.each(["single", "multiple"])(
    "leaves %s threads unchanged when confirmation is cancelled",
    async (size) => {
      renderProvider(
        size === "single" ? (
          <ArchiveButton thread={makeThread()} />
        ) : (
          <SelectionButtons
            threads={[makeThread(), makeThread({ id: "thr_other" })]}
          />
        ),
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: size === "single" ? "Archive" : "Archive selection",
        }),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
    },
  );
});

describe("ThreadActionsProvider archive feedback", () => {
  it.each(["single", "multiple", "environment"])(
    "restores parents before descendants when undoing a %s archive",
    async (source) => {
      mocks.confirmThreadArchive = false;
      const archivedThreadIds = ["thr_grandchild", "thr_child", "thr_parent"];
      vi.mocked(sdk.environments.archiveThreads).mockResolvedValue({
        ok: true,
        archivedThreadIds,
      });
      vi.mocked(sdk.threads.archiveAll).mockImplementation(
        async ({ threadId }) => ({
          ok: true,
          archivedThreadIds:
            threadId === "thr_parent" ? archivedThreadIds : [threadId],
        }),
      );
      const expectedRestored =
        source === "multiple"
          ? ["thr_parent", "thr_child", "thr_grandchild", "thr_other"]
          : ["thr_parent", "thr_child", "thr_grandchild"];
      renderProvider(
        source === "environment" ? (
          <ArchiveEnvironmentButton />
        ) : source === "single" ? (
          <ArchiveButton thread={makeThread()} />
        ) : (
          <SelectionButtons
            threads={[makeThread({ id: "thr_other" }), makeThread()]}
          />
        ),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name:
            source === "environment"
              ? "Archive group"
              : source === "single"
                ? "Archive"
                : "Archive selection",
        }),
      );
      await vi.waitFor(() => expect(appToast.success).toHaveBeenCalledTimes(1));
      const call = vi.mocked(appToast.success).mock.calls[0];
      if (!call) throw new Error("Expected archive toast");
      const [title, options] = call;
      expect(title).toBe(
        source === "single" ? "Thread archived" : "Threads archived",
      );
      expect(options).toMatchObject({
        cancel: { label: "Undo" },
        duration: 10_000,
      });
      const undo = options?.cancel;
      if (!undo) throw new Error("Expected archive Undo");
      let releaseParent!: () => void;
      vi.mocked(sdk.threads.unarchive).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseParent = () => resolve({ ok: true });
          }),
      );
      render(<button onClick={undo.onClick}>Undo archive</button>);
      fireEvent.click(screen.getByRole("button", { name: "Undo archive" }));
      await vi.waitFor(() =>
        expect(sdk.threads.unarchive).toHaveBeenCalledTimes(1),
      );
      expect(sdk.threads.unarchive).toHaveBeenLastCalledWith({
        threadId: "thr_parent",
      });
      await act(async () => {
        releaseParent();
      });
      await vi.waitFor(() =>
        expect(
          vi
            .mocked(sdk.threads.unarchive)
            .mock.calls.map(([args]) => args.threadId),
        ).toEqual(expectedRestored),
      );
    },
  );

  it("shows one archive toast whose Undo restores the parent and children", async () => {
    renderProvider(<ArchiveButton thread={makeThread()} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );

    await vi.waitFor(() => {
      expect(appToast.success).toHaveBeenCalledTimes(1);
    });
    expect(appToast.message).not.toHaveBeenCalled();
    expect(vi.mocked(appToast.success).mock.calls[0]?.[0]).toBe(
      "Thread archived",
    );
    const toastOptions = vi.mocked(appToast.success).mock.calls[0]?.[1];
    expect(toastOptions).toMatchObject({
      cancel: { label: "Undo" },
      duration: 10_000,
      id: "thread-archived-thr_parent",
    });
    expect(toastOptions?.action).toBeUndefined();
    render(
      <QueryClientProvider client={queryClient}>
        {toastOptions?.description}
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Investigate archive behavior" }),
    );
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      `/projects/${makeThread().projectId}/threads/thr_parent`,
    );
    expect(appToast.dismiss).toHaveBeenCalledWith("thread-archived-thr_parent");

    const undoAction = toastOptions?.cancel;
    if (undoAction === undefined) {
      throw new Error("Expected archive toast to provide Undo");
    }
    render(<button onClick={undoAction.onClick}>Run undo</button>);
    fireEvent.click(screen.getByRole("button", { name: "Run undo" }));

    await vi.waitFor(() => {
      expect(sdk.threads.unarchive).toHaveBeenCalledTimes(2);
    });
    expect(sdk.threads.unarchive).toHaveBeenNthCalledWith(1, {
      threadId: "thr_parent",
    });
    expect(sdk.threads.unarchive).toHaveBeenNthCalledWith(2, {
      threadId: "thr_child",
    });
  });

  it("returns to the thread when Undo reverses archive navigation", async () => {
    const thread = makeThread();
    mocks.pathname = `/projects/${thread.projectId}/threads/${thread.id}`;
    mocks.viewedThreadId = thread.id;
    const view = renderProvider(<ArchiveButton thread={thread} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );

    await vi.waitFor(() => {
      expect(appToast.success).toHaveBeenCalledTimes(1);
    });
    expect(mocks.navigate).toHaveBeenCalledWith("/");
    mocks.pathname = "/";
    mocks.viewedThreadId = undefined;
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ThreadActionsProvider>
          <ArchiveButton thread={thread} />
        </ThreadActionsProvider>
      </QueryClientProvider>,
    );

    const undoAction = vi.mocked(appToast.success).mock.calls[0]?.[1]?.cancel;
    if (undoAction === undefined) {
      throw new Error("Expected archive toast to provide Undo");
    }
    render(<button onClick={undoAction.onClick}>Run undo</button>);
    fireEvent.click(screen.getByRole("button", { name: "Run undo" }));

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenLastCalledWith(
        `/projects/${thread.projectId}/threads/${thread.id}`,
      ),
    );
  });

  it("does not return to the thread when the user navigated after archiving", async () => {
    const thread = makeThread();
    mocks.pathname = `/projects/${thread.projectId}/threads/${thread.id}`;
    mocks.viewedThreadId = thread.id;
    const view = renderProvider(<ArchiveButton thread={thread} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Archive",
      }),
    );

    await vi.waitFor(() => {
      expect(appToast.success).toHaveBeenCalledTimes(1);
    });
    mocks.pathname = "/settings";
    mocks.viewedThreadId = undefined;
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ThreadActionsProvider>
          <ArchiveButton thread={thread} />
        </ThreadActionsProvider>
      </QueryClientProvider>,
    );

    const undoAction = vi.mocked(appToast.success).mock.calls[0]?.[1]?.cancel;
    if (undoAction === undefined) {
      throw new Error("Expected archive toast to provide Undo");
    }
    render(<button onClick={undoAction.onClick}>Run undo</button>);
    fireEvent.click(screen.getByRole("button", { name: "Run undo" }));

    await vi.waitFor(() =>
      expect(sdk.threads.unarchive).toHaveBeenCalledTimes(2),
    );
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });
});

describe("ThreadActionsProvider selections", () => {
  const parent = makeThread({ id: "thr_parent" });
  const child = makeThread({ id: "thr_child", parentThreadId: "thr_parent" });
  const other = makeThread({ id: "thr_other" });

  beforeEach(() => {
    vi.mocked(sdk.threads.archiveAll).mockImplementation(
      async ({ threadId }) => ({
        archivedThreadIds:
          threadId === "thr_parent" ? ["thr_child", "thr_parent"] : [threadId],
        ok: true,
      }),
    );
    mocks.deleteThread.mockResolvedValue(undefined);
  });

  it("archives only the topmost selected threads and offers one Undo for everything archived", async () => {
    mockCascade({ thr_parent: ["thr_child"] });
    renderProvider(<SelectionButtons threads={[parent, child, other]} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive selection" }));

    await vi.waitFor(() => expect(appToast.success).toHaveBeenCalledTimes(1));
    expect(sdk.threads.experimental_listCascade).toHaveBeenCalledWith(
      expect.objectContaining({
        threadIds: ["thr_parent", "thr_child", "thr_other"],
        action: "archive",
      }),
    );
    expect(vi.mocked(sdk.threads.archiveAll).mock.calls).toEqual([
      [{ threadId: "thr_parent" }],
      [{ threadId: "thr_other" }],
    ]);
    expect(sdk.threads.childSummary).not.toHaveBeenCalled();
    expect(mocks.closePanesForThreads).toHaveBeenCalledWith([
      "thr_child",
      "thr_parent",
      "thr_other",
    ]);
    expect(vi.mocked(appToast.success).mock.calls[0]?.[1]?.description).toBe(
      "Archived 3 threads",
    );
  });

  it("confirms once with the unselected child threads before archiving a selection", async () => {
    mockCascade({ thr_parent: ["thr_child", "thr_hidden_kid"] });
    renderProvider(<SelectionButtons threads={[parent, child, other]} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive selection" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Archive 3 threads?" }),
    ).toBeTruthy();
    expect(dialog.textContent).toContain(
      "Their 1 child thread will be archived too.",
    );
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await vi.waitFor(() =>
      expect(sdk.threads.archiveAll).toHaveBeenCalledTimes(2),
    );
  });

  it("archives a selection without asking when confirmation is disabled", async () => {
    mocks.confirmThreadArchive = false;
    mockCascade({ thr_parent: ["thr_unselected"] });
    renderProvider(<SelectionButtons threads={[parent, other]} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive selection" }));

    await vi.waitFor(() =>
      expect(sdk.threads.archiveAll).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves already archived threads out of a selection archive", async () => {
    mockCascade({});
    renderProvider(
      <SelectionButtons
        threads={[makeThread({ id: "thr_done", archivedAt: 2 }), parent, other]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive selection" }));

    await vi.waitFor(() =>
      expect(sdk.threads.archiveAll).toHaveBeenCalledTimes(2),
    );
    expect(sdk.threads.experimental_listCascade).toHaveBeenCalledWith(
      expect.objectContaining({ threadIds: ["thr_parent", "thr_other"] }),
    );
  });

  it("confirms a selection delete once and deletes only its topmost threads", async () => {
    mockCascade({ thr_parent: ["thr_child", "thr_kid"] });
    mocks.viewedThreadId = "thr_kid";
    renderProvider(<SelectionButtons threads={[parent, child, other]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete selection" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete 3 with 1 children");
    expect(sdk.threads.experimental_listCascade).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete" }),
    );
    expect(mocks.deleteThread).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm delete" }),
    );
    await vi.waitFor(() =>
      expect(mocks.closePanesForThreads).toHaveBeenCalledWith([
        "thr_parent",
        "thr_child",
        "thr_kid",
        "thr_other",
      ]),
    );
    expect(mocks.deleteThread.mock.calls).toEqual([
      [{ id: "thr_parent", childThreadsConfirmed: true }],
      [{ id: "thr_other", childThreadsConfirmed: true }],
    ]);
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("counts a single thread's whole delete cascade, grandchildren and lifecycle dependents included", async () => {
    mockCascade({
      thr_parent: ["thr_child", "thr_grandchild", "thr_owned_helper"],
    });
    renderProvider(<SelectionButtons threads={[parent]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete selection" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete 1 with 3 children");
    expect(sdk.threads.childSummary).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm delete" }),
    );
    await vi.waitFor(() =>
      expect(mocks.closePanesForThreads).toHaveBeenCalledWith([
        "thr_parent",
        "thr_child",
        "thr_grandchild",
        "thr_owned_helper",
      ]),
    );
    expect(mocks.deleteThread.mock.calls).toEqual([
      [{ id: "thr_parent", childThreadsConfirmed: true }],
    ]);
  });

  it("keeps the delete dialog open when nothing could be deleted", async () => {
    mockCascade({});
    mocks.deleteThread.mockRejectedValue(new Error("Delete failed"));
    renderProvider(<SelectionButtons threads={[parent]} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete selection" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm delete" }),
    );

    await vi.waitFor(() => expect(mocks.deleteThread).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mocks.closePanesForThreads).not.toHaveBeenCalled();
  });
});
