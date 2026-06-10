// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PERSONAL_PROJECT_ID, type ThreadWithRuntime } from "@bb/domain";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Provider as JotaiProvider } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ThreadChildSummaryResponse } from "@bb/server-contract";
import * as api from "@/lib/api";
import { createAppQueryClient } from "@/lib/query-client";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";

interface ThreadToastButton {
  label: ReactNode;
  onClick: () => void;
}

interface CapturedToastProps {
  action?: ThreadToastButton;
  cancel?: ThreadToastButton;
  description?: ReactNode;
  title: ReactNode;
  tone: string;
}

interface CapturedToastOptions {
  id: string;
}

interface ThreadToastInvocation {
  options: CapturedToastOptions;
  props: CapturedToastProps;
}

type ThreadChildSummaryOverrides = Partial<ThreadChildSummaryResponse>;

interface SonnerCustomOptions {
  id?: string | number;
}

interface SonnerCustomToast {
  options: CapturedToastOptions;
  renderToast: (id: string | number) => ReactElement;
}

interface RenderWithProviderOptions {
  initialEntries?: string[];
}

const threadToastState = vi.hoisted(() => {
  const invocations: SonnerCustomToast[] = [];
  return {
    custom: vi.fn(
      (
        renderToast: (id: string | number) => ReactElement,
        options?: SonnerCustomOptions,
      ) => {
        const fallbackId = `toast-${invocations.length + 1}`;
        const id =
          typeof options?.id === "string" || typeof options?.id === "number"
            ? String(options.id)
            : fallbackId;
        const toast = {
          options: { id },
          renderToast,
        };
        invocations.push(toast);
        return id;
      },
    ),
    dismiss: vi.fn(),
    invocations,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    archiveThreadAndChildren: vi.fn(),
    deleteThread: vi.fn(),
    getThreadChildSummary: vi.fn(),
    markThreadRead: vi.fn(),
    markThreadUnread: vi.fn(),
    pinThread: vi.fn(),
    unarchiveThread: vi.fn(),
    unpinThread: vi.fn(),
    updateThread: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: {
    custom: threadToastState.custom,
    dismiss: threadToastState.dismiss,
  },
}));

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "project-1",
    providerId: "provider-1",
    stopRequestedAt: null,
    status: "idle",
    title: "Thread title",
    titleFallback: "Thread title",
    updatedAt: 10,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function makeChildSummary(
  overrides: ThreadChildSummaryOverrides = {},
): ThreadChildSummaryResponse {
  return {
    nonDeletedChildCount: 0,
    ...overrides,
  };
}

function renderWithProvider(
  children: ReactNode,
  options: RenderWithProviderOptions = {},
) {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={options.initialEntries}>
          <ThreadActionsProvider>{children}</ThreadActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
}

function HookProbe({
  onReady,
}: {
  onReady: (actions: ReturnType<typeof useThreadActions>) => void;
}) {
  const actions = useThreadActions();
  onReady(actions);
  return null;
}

function RouteProbe() {
  const location = useLocation();
  const [rootComposeProjectId] = useRootComposeProjectId();

  return (
    <>
      <span data-testid="route-pathname">{location.pathname}</span>
      <span data-testid="root-compose-project-id">{rootComposeProjectId}</span>
    </>
  );
}

function readThreadToast(toast: SonnerCustomToast): ThreadToastInvocation {
  const element = toast.renderToast(toast.options.id);
  if (!isValidElement<CapturedToastProps>(element)) {
    throw new Error("Expected app toast content element.");
  }
  return {
    options: toast.options,
    props: element.props,
  };
}

function requireLatestThreadToastInvocation(): ThreadToastInvocation {
  const invocation = threadToastState.invocations.at(-1);
  if (!invocation) {
    throw new Error("Expected thread action toast invocation.");
  }
  return readThreadToast(invocation);
}

afterEach(() => {
  cleanup();
  threadToastState.invocations.splice(0);
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(api.getThreadChildSummary).mockResolvedValue(
    makeChildSummary(),
  );
});

describe("ThreadActionsProvider", () => {
  it("toggles thread pin state", async () => {
    const thread = makeThread();
    const pinnedThread = makeThread({
      pinnedAt: 1_000,
    });
    vi.mocked(api.pinThread).mockResolvedValue(pinnedThread);
    vi.mocked(api.unpinThread).mockResolvedValue(thread);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.togglePin(thread);
    });

    await waitFor(() => {
      expect(api.pinThread).toHaveBeenCalledWith(thread.id);
    });

    act(() => {
      actions!.togglePin(pinnedThread);
    });

    await waitFor(() => {
      expect(api.unpinThread).toHaveBeenCalledWith(thread.id);
    });
  });

  it("unarchives an archived thread", async () => {
    const thread = makeThread({
      archivedAt: 1_000,
    });
    vi.mocked(api.unarchiveThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.unarchiveThread(thread);
    });

    await waitFor(() => {
      expect(api.unarchiveThread).toHaveBeenCalledWith(thread.id);
    });
  });

  it("archives a thread and its children with a grouped success toast linking to the thread", async () => {
    const thread = makeThread({ id: "parent-1" });
    vi.mocked(api.archiveThreadAndChildren).mockResolvedValue({
      ok: true,
      archivedThreadIds: ["child-1", thread.id],
    });

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <>
        <HookProbe
          onReady={(a) => {
            actions = a;
          }}
        />
        <RouteProbe />
      </>,
    );

    act(() => {
      actions!.archiveThreadAndChildren(thread);
    });

    await waitFor(() => {
      expect(api.archiveThreadAndChildren).toHaveBeenCalledWith(thread.id);
    });
    const successInvocation = requireLatestThreadToastInvocation();
    expect(successInvocation.props.tone).toBe("success");

    const { container: titleContainer } = render(
      <>{successInvocation.props.title}</>,
    );
    expect(titleContainer.textContent).toBe(
      "Archived Thread title and 1 child thread",
    );

    fireEvent.click(screen.getByRole("button", { name: "Thread title" }));
    await waitFor(() => {
      expect(screen.getByTestId("route-pathname").textContent).toBe(
        "/projects/project-1/threads/parent-1",
      );
    });
    expect(threadToastState.dismiss).toHaveBeenCalledWith(
      successInvocation.options.id,
    );
  });

  it("returns to root compose when archive thread and children includes the current projectless thread", async () => {
    const thread = makeThread({
      id: "manager-1",
      projectId: PERSONAL_PROJECT_ID,
    });
    vi.mocked(api.archiveThreadAndChildren).mockResolvedValue({
      ok: true,
      archivedThreadIds: ["child-1", thread.id],
    });

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <>
        <HookProbe
          onReady={(a) => {
            actions = a;
          }}
        />
        <RouteProbe />
      </>,
      { initialEntries: ["/threads/child-1"] },
    );

    act(() => {
      actions!.archiveThreadAndChildren(thread);
    });

    await waitFor(() => {
      expect(api.archiveThreadAndChildren).toHaveBeenCalledWith(thread.id);
    });
    await waitFor(() => {
      expect(screen.getByTestId("route-pathname").textContent).toBe("/");
    });
    expect(screen.getByTestId("root-compose-project-id").textContent).toBe(
      PERSONAL_PROJECT_ID,
    );
  });

  it("confirms before deleting a thread with child threads", async () => {
    const thread = makeThread();
    vi.mocked(api.getThreadChildSummary).mockResolvedValue(
      makeChildSummary({
        nonDeletedChildCount: 1,
      }),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    expect(
      await screen.findByText(/child threads will be deleted/i),
    ).not.toBeNull();
    expect(api.deleteThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete thread/i }));

    await waitFor(() => {
      expect(api.deleteThread).toHaveBeenCalledWith(thread.id, {
        childThreadsConfirmed: true,
      });
    });
  });

  it("does not delete when the child-thread confirmation is cancelled", async () => {
    const thread = makeThread();
    vi.mocked(api.getThreadChildSummary).mockResolvedValue(
      makeChildSummary({
        nonDeletedChildCount: 1,
      }),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    await screen.findByText(/child threads will be deleted/i);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(
        screen.queryByText(/child threads will be deleted/i),
      ).toBeNull();
    });
    expect(api.deleteThread).not.toHaveBeenCalled();
  });

  it("does not delete and shows a toast when the child summary fails", async () => {
    const thread = makeThread();
    vi.mocked(api.getThreadChildSummary).mockRejectedValue(
      new Error("Summary failed"),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    await waitFor(() => {
      expect(threadToastState.custom).toHaveBeenCalled();
    });
    expect(requireLatestThreadToastInvocation().props.tone).toBe("error");
    expect(api.deleteThread).not.toHaveBeenCalled();
  });

  it("uses the regular delete confirmation for a thread without child threads", async () => {
    const thread = makeThread();
    vi.mocked(api.getThreadChildSummary).mockResolvedValue(
      makeChildSummary(),
    );
    vi.mocked(api.deleteThread).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useThreadActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
    );

    act(() => {
      actions!.requestDelete(thread);
    });

    const confirmButton = await screen.findByRole("button", {
      name: /delete thread/i,
    });

    expect(
      screen.queryByText(/child threads will be deleted/i),
    ).toBeNull();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.deleteThread).toHaveBeenCalledWith(thread.id, {
        childThreadsConfirmed: false,
      });
    });
  });
});
