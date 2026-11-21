// @vitest-environment jsdom

import { useLayoutEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadRequests } from "@get-bb/plugin-sdk";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { appToast } from "@/components/ui/app-toast";
import { PluginContext } from "@/components/plugin/plugin-context";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { usePluginActionContextBinder } from "@/lib/plugin-navigation-hooks";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import { resetThreadActionRegistryForTest } from "@/lib/thread-actions/thread-action-registry";
import { sdk } from "@/lib/sdk";
import { ThreadActionsProvider } from "./ThreadActionsProvider";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { archiveThreads: vi.fn() },
    threads: {
      archiveAll: vi.fn(),
      delete: vi.fn(),
      experimental_listCascade: vi.fn(),
      get: vi.fn(),
      unarchive: vi.fn(),
    },
  },
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

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { confirmThreadArchive: true } },
  }),
}));

const parent = makeThreadResponse({
  id: "thr_parent",
  status: "idle",
  title: "Parent",
});
const sibling = makeThreadResponse({
  id: "thr_sibling",
  status: "idle",
  title: "Sibling",
});
const threadsById = new Map([parent, sibling].map((t) => [t.id, t]));

let captured: {
  hook: ExperimentalThreadRequests;
  context: ExperimentalThreadRequests;
} | null = null;

function Capture() {
  const hook = pluginSdkAppImplementation.experimental_useThreadRequests();
  const bind = usePluginActionContextBinder();
  const host = useAppNavigationHost();
  useLayoutEffect(() => {
    captured = { hook, context: bind("fixture", () => host).threadRequests };
  });
  return null;
}

function renderRequests(): {
  hook: ExperimentalThreadRequests;
  context: ExperimentalThreadRequests;
} {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={createStore()}>
        <MemoryRouter>
          <ThreadActionsProvider>
            <PluginContext.Provider value="fixture">
              <Capture />
            </PluginContext.Provider>
          </ThreadActionsProvider>
        </MemoryRouter>
      </Provider>
    </QueryClientProvider>,
  );
  if (captured === null) throw new Error("Thread requests were not captured");
  return captured;
}

function track(promise: Promise<void>): { settled: () => boolean } {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  return { settled: () => settled };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(sdk.threads.get).mockImplementation(async ({ threadId }) => {
    const thread = threadsById.get(threadId);
    if (thread === undefined) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  });
  vi.mocked(sdk.threads.experimental_listCascade).mockImplementation(
    async ({ threadIds }) => ({
      threads: threadIds.map((threadId) => ({
        threadId,
        cascadeThreadIds: threadId === parent.id ? ["thr_child"] : [],
      })),
    }),
  );
  vi.mocked(sdk.threads.unarchive).mockResolvedValue({
    ok: true,
    progress: "complete",
  });
});

afterEach(() => {
  cleanup();
  captured = null;
  resetThreadActionRegistryForTest();
  vi.clearAllMocks();
});

describe("thread requests", () => {
  it("fetches a thread the app has not loaded, confirms with the server's child count, and settles on cancel", async () => {
    const { hook } = renderRequests();
    const request = track(hook.requestArchive([parent.id]));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Archive thread?");
    expect(dialog.textContent).toContain("1 child thread");
    expect(sdk.threads.get).toHaveBeenCalledWith({ threadId: parent.id });
    expect(request.settled()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(request.settled()).toBe(true));
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it("settles a confirmed archive only after it finishes, with one Undo toast", async () => {
    const archive = deferred<{ archivedThreadIds: string[]; ok: true }>();
    vi.mocked(sdk.threads.archiveAll).mockReturnValue(archive.promise);
    const { context } = renderRequests();
    const request = track(context.requestArchive([parent.id]));

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(sdk.threads.archiveAll).toHaveBeenCalledWith({
        threadId: parent.id,
      }),
    );
    expect(request.settled()).toBe(false);

    archive.resolve({ archivedThreadIds: ["thr_child", parent.id], ok: true });
    await waitFor(() => expect(request.settled()).toBe(true));
    expect(appToast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appToast.success).mock.calls[0]?.[1]?.cancel?.label).toBe(
      "Undo",
    );
  });

  it("confirms a bulk delete once and stays pending while a failed delete keeps the dialog open", async () => {
    vi.mocked(sdk.threads.delete).mockRejectedValue(new Error("Delete failed"));
    const { context } = renderRequests();
    const request = track(context.requestDelete([parent.id, sibling.id]));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Delete 2 threads?");
    expect(dialog.textContent).toContain("1 child thread");
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 threads" }));
    await waitFor(() => expect(sdk.threads.delete).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(request.settled()).toBe(false);

    vi.mocked(sdk.threads.delete).mockResolvedValue({
      ok: true,
      progress: "complete",
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 threads" }));
    await waitFor(() => expect(request.settled()).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an error toast and opens no dialog for an id that does not exist", async () => {
    const { hook } = renderRequests();

    await hook.requestDelete(["thr_missing"]);

    expect(appToast.error).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sdk.threads.experimental_listCascade).not.toHaveBeenCalled();
  });
});
