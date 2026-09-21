// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT } from "@/lib/sidebar-bootstrap-cache";
import {
  ForkAppStateRestore,
  clearForkLastThread,
  readForkLastThread,
} from "./fork-app-state-restore";

const sidebarCache = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/sidebar-bootstrap-cache", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/sidebar-bootstrap-cache")>();
  return { ...actual, readCachedSidebarBootstrap: () => sidebarCache.value };
});

const LAST_THREAD_STORAGE_KEY = "bb.fork.lastThread";

function bootstrapWithThread(
  projectId: string,
  threadId: string,
): Record<string, unknown> {
  return bootstrapWithThreads(projectId, [threadId]);
}

function bootstrapWithThreads(
  projectId: string,
  threadIds: readonly string[],
): Record<string, unknown> {
  return {
    projects: [{ id: projectId, threads: threadIds.map((id) => ({ id })) }],
    personalProject: { threads: [] },
    sections: [],
  };
}

function RouteProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <button type="button" onClick={() => navigate("/")}>
        Home
      </button>
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ForkAppStateRestore />
      <RouteProbe />
    </MemoryRouter>,
  );
}

function writeStored(value: { projectId: string; threadId: string }): void {
  window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, JSON.stringify(value));
}

beforeEach(() => {
  window.localStorage.clear();
  sidebarCache.value = null;
});

afterEach(() => {
  cleanup();
});

describe("ForkAppStateRestore", () => {
  it("restores the remembered thread when the app opens at the root", async () => {
    writeStored({ projectId: "proj_1", threadId: "thread_1" });
    sidebarCache.value = bootstrapWithThread("proj_1", "thread_1");

    renderAt("/");

    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        "/projects/proj_1/threads/thread_1",
      ),
    );
  });

  it("restores a projectless thread with its own route shape", async () => {
    writeStored({ projectId: "proj_personal", threadId: "thread_2" });

    renderAt("/");

    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/threads/thread_2"),
    );
  });

  it("remembers the thread the user is looking at", async () => {
    sidebarCache.value = bootstrapWithThread("proj_1", "thread_1");

    renderAt("/projects/proj_1/threads/thread_1");

    await waitFor(() =>
      expect(readForkLastThread()).toEqual({
        projectId: "proj_1",
        threadId: "thread_1",
      }),
    );
  });

  it("does not redirect after the user navigates to the root in-session", async () => {
    writeStored({ projectId: "proj_1", threadId: "thread_1" });
    sidebarCache.value = bootstrapWithThread("proj_1", "thread_1");

    renderAt("/projects/proj_1/threads/thread_1");
    await waitFor(() =>
      expect(readForkLastThread()).toEqual({
        projectId: "proj_1",
        threadId: "thread_1",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/"),
    );
  });

  it("forgets a thread the sidebar no longer knows about", async () => {
    writeStored({ projectId: "proj_1", threadId: "thread_gone" });
    sidebarCache.value = bootstrapWithThread("proj_1", "thread_1");

    renderAt("/");

    await waitFor(() => expect(readForkLastThread()).toBeNull());
    expect(screen.getByTestId("path").textContent).toBe("/");
  });

  it("forgets a thread whose project is gone", async () => {
    writeStored({ projectId: "proj_gone", threadId: "thread_1" });
    sidebarCache.value = bootstrapWithThread("proj_1", "thread_1");

    renderAt("/");

    await waitFor(() => expect(readForkLastThread()).toBeNull());
    expect(screen.getByTestId("path").textContent).toBe("/");
  });

  it("keeps a thread missing from a bounded cache page", async () => {
    const cachedIds = Array.from(
      { length: MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT },
      (_, index) => `thread_${index}`,
    );
    writeStored({ projectId: "proj_1", threadId: "thread_older" });
    sidebarCache.value = bootstrapWithThreads("proj_1", cachedIds);

    renderAt("/");

    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(
        "/projects/proj_1/threads/thread_older",
      ),
    );
  });

  it("ignores unreadable stored values", () => {
    window.localStorage.setItem(LAST_THREAD_STORAGE_KEY, "not json");
    expect(readForkLastThread()).toBeNull();

    window.localStorage.setItem(
      LAST_THREAD_STORAGE_KEY,
      JSON.stringify({ projectId: "", threadId: "thread_1" }),
    );
    expect(readForkLastThread()).toBeNull();
  });

  it("clears the remembered thread", () => {
    writeStored({ projectId: "proj_1", threadId: "thread_1" });

    clearForkLastThread();

    expect(readForkLastThread()).toBeNull();
  });
});
