// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { AppRoutes } from "./App";

const downloads = await vi.hoisted(async () => {
  const { createDeferredPromise } = await import("@bb/test-helpers");
  return {
    workspace: createDeferredPromise<void>(),
    compose: vi.fn(),
    thread: vi.fn(),
  };
});

vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./views/SplitWorkspaceRoute", async () => {
  await downloads.workspace.promise;
  return { default: () => <p>Workspace ready</p> };
});
vi.mock("./views/RootComposeView", () => {
  downloads.compose();
  return { RootComposeView: () => <p>Compose ready</p> };
});
vi.mock("./views/thread-detail/ThreadDetailView", () => {
  downloads.thread();
  return { ThreadDetailView: () => <p>Thread ready</p> };
});

afterEach(cleanup);

it("starts destination code before the workspace settles and keeps thread code off new-thread startup", async () => {
  function Navigation() {
    const navigate = useNavigate();
    return (
      <>
        <button onClick={() => void navigate("/threads/thr_example")}>
          Open personal thread
        </button>
        <button
          onClick={() =>
            void navigate("/projects/proj_example/threads/thr_other")
          }
        >
          Open project thread
        </button>
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Navigation />
      <AppRoutes />
    </MemoryRouter>,
  );
  await waitFor(() => expect(downloads.compose).toHaveBeenCalledTimes(1));
  expect(downloads.thread).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Open personal thread" }));
  await waitFor(() => expect(downloads.thread).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole("button", { name: "Open project thread" }));
  expect(downloads.thread).toHaveBeenCalledTimes(1);
  await act(async () => {
    downloads.workspace.resolve();
  });
});
