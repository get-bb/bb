// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installTestPluginRuntime,
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();
const app = await loadPluginApp(() => import("./app"));
const { WorkspaceExplorerPanel } = await import("./explorer-panel");

afterEach(cleanup);

const BS = "\\";

const THREAD_A = "thr_100000000000000000000001";
const THREAD_B = "thr_200000000000000000000002";
const ENV_A = "env_1000000000000000000000001";
const ENV_B = "env_2000000000000000000000002";

const openFilePreview = vi.fn(() => true);

function rpc(listings: Record<string, unknown>, rootByThread?: Record<string, unknown>) {
  return {
    explorerRoot: async (input: { threadId: string }) =>
      (rootByThread ?? {})[input.threadId] ?? {
        status: "ready",
        environmentId: ENV_A,
        environmentName: "main worktree",
        hostId: "mach_a",
        rootPath: "C:\\repo",
      },
    explorerList: async (input: { path: string }) =>
      listings[input.path] ?? {
        path: input.path,
        environmentId: ENV_A,
        rootPath: "C:" + BS + "repo",
        entries: [],
      },
  };
}

const rootListing = {
  path: "",
  environmentId: ENV_A,
  rootPath: "C:" + BS + "repo",
  entries: [
    { kind: "directory", name: "src", relativePath: "src" },
    { kind: "directory", name: "lib", relativePath: "lib" },
    { kind: "file", name: "README.md", relativePath: "README.md" },
  ],
};

const srcListing = {
  path: "src",
  environmentId: ENV_A,
  rootPath: "C:" + BS + "repo",
  entries: [{ kind: "file", name: "child.txt", relativePath: "src/child.txt" }],
};

const libListing = {
  path: "lib",
  environmentId: ENV_A,
  rootPath: "C:" + BS + "repo",
  entries: [{ kind: "file", name: "util.ts", relativePath: "lib/util.ts" }],
};

function renderPanel(
  rpcValue: Record<string, unknown>,
  threadId = THREAD_A,
) {
  return renderSlot(
    { component: WorkspaceExplorerPanel },
    { threadId, params: null },
    { rpc: rpcValue, openFilePreview },
  );
}

describe("Workspace Explorer panel", () => {
  it("registers as a thread panel action titled Explorer", () => {
    const action = app.threadPanelActions.find(
      (entry) => entry.id === "workspace-explorer",
    );
    expect(action).toBeDefined();
    expect(action!.title).toBe("Explorer");
    expect(action!.icon).toBe("FolderOpen");
  });

  it("shows the workspace tree with folders first and lazy children", async () => {
    renderPanel(rpc({ "": rootListing, src: srcListing }));

    expect(await screen.findByText("src")).toBeDefined();
    expect(screen.getByText("README.md")).toBeDefined();
    expect(screen.queryByText("child.txt")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "src" }));
    });
    expect(await screen.findByText("child.txt")).toBeDefined();
  });

  it("opens a file through the workspace preview target", async () => {
    renderPanel(rpc({ "": rootListing }));

    await screen.findByText("README.md");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    });
    expect(openFilePreview).toHaveBeenCalledWith({
      target: { kind: "workspace", environmentId: ENV_A, path: "README.md" },
      location: null,
    });
  });

  it("explains threads without an environment workspace", async () => {
    renderPanel(
      rpc({}, { [THREAD_A]: { status: "no-environment" } }),
    );
    expect(
      await screen.findByText(/no environment workspace to browse/),
    ).toBeDefined();
  });

  it("recovers from a listing error with retry", async () => {
    let fail = true;
    const rpcValue = {
      explorerRoot: async () => ({
        status: "ready",
        environmentId: ENV_A,
        environmentName: null,
        hostId: "mach_a",
        rootPath: "C:\\repo",
      }),
      explorerList: async () => {
        if (fail) throw new Error("host offline");
        return rootListing;
      },
    };
    renderPanel(rpcValue);

    expect(await screen.findByText(/Couldn't list: host offline/)).toBeDefined();
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(await screen.findByText("README.md")).toBeDefined();
  });

  it("completes both folders when expanded concurrently in either order", async () => {
    for (const order of ["src-first", "lib-first"]) {
      cleanup();
      const deferred: Record<string, Array<(value: unknown) => void>> = {
        src: [],
        lib: [],
        "": [],
      };
      const rpcValue = {
        explorerRoot: async () => ({
          status: "ready",
          environmentId: ENV_A,
          environmentName: null,
          hostId: "mach_a",
          rootPath: "C:" + BS + "repo",
        }),
        explorerList: (input: { path: string }) =>
          input.path === ""
            ? Promise.resolve(rootListing)
            : new Promise((resolve) => {
                deferred[input.path]!.push(() =>
                  resolve(
                    input.path === "src"
                      ? srcListing
                      : libListing,
                  ),
                );
              }),
      };
      renderPanel(rpcValue);
      await screen.findByText("src");

      const first = order === "src-first" ? "src" : "lib";
      const second = order === "src-first" ? "lib" : "src";
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: first }));
        fireEvent.click(screen.getByRole("button", { name: second }));
      });

      await act(async () => {
        deferred[second]!.forEach((release) => release());
      });
      await act(async () => {
        deferred[first]!.forEach((release) => release());
      });

      expect(await screen.findByText("child.txt")).toBeDefined();
      expect(await screen.findByText("util.ts")).toBeDefined();
    }
  });

  it("Refresh collapses expansions and reloads the root in the fresh context", async () => {
    let listingCalls = 0;
    const rpcValue = {
      explorerRoot: async () => ({
        status: "ready",
        environmentId: ENV_A,
        environmentName: null,
        hostId: "mach_a",
        rootPath: "C:" + BS + "repo",
      }),
      explorerList: async (input: { path: string }) => {
        listingCalls += 1;
        if (input.path === "") return rootListing;
        return srcListing;
      },
    };
    renderPanel(rpcValue);
    await screen.findByText("src");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "src" }));
    });
    expect(await screen.findByText("child.txt")).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh explorer" }));
    });
    expect(await screen.findByText("README.md")).toBeDefined();
    expect(screen.queryByText("child.txt")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "src" }));
    });
    expect(await screen.findByText("child.txt")).toBeDefined();
    expect(listingCalls).toBeGreaterThanOrEqual(3);
  });

  it("never previews in environment A a listing that arrived for environment B", async () => {
    let currentEnvironment = ENV_A;
    const deferred: Array<(value: unknown) => void> = [];
    const rpcValue = {
      explorerRoot: async () => ({
        status: "ready",
        environmentId: currentEnvironment,
        environmentName: null,
        hostId: currentEnvironment === ENV_A ? "mach_a" : "mach_b",
        rootPath: currentEnvironment === ENV_A ? "C:" + BS + "repo" : "/repo/b",
      }),
      explorerList: () =>
        new Promise((resolve) => {
          deferred.push(() =>
            resolve({
              path: "",
              environmentId: currentEnvironment,
              rootPath: currentEnvironment === ENV_A ? "C:" + BS + "repo" : "/repo/b",
              entries: [
                {
                  kind: "file",
                  name: currentEnvironment === ENV_A ? "from-a.txt" : "from-b.txt",
                  relativePath: currentEnvironment === ENV_A ? "from-a.txt" : "from-b.txt",
                },
              ],
            }),
          );
        }),
    };
    renderPanel(rpcValue);
    await waitFor(() => expect(deferred.length).toBeGreaterThan(0));

    currentEnvironment = ENV_B;
    deferred.forEach((release) => release());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("from-a.txt")).toBeNull();
  });

  it("does not show late entries from a previous thread", async () => {
    let resolveFirst!: (value: unknown) => void;
    const rpcValue = {
      explorerRoot: async (input: { threadId: string }) => ({
        status: "ready",
        environmentId: input.threadId === THREAD_A ? ENV_A : ENV_B,
        environmentName: null,
        hostId: input.threadId === THREAD_A ? "mach_a" : "mach_b",
        rootPath: input.threadId === THREAD_A ? "C:\\repo" : "/repo/b",
      }),
      explorerList: (input: { path: string }) =>
        input.path === ""
          ? new Promise((resolve) => {
              resolveFirst = resolve;
            })
          : {
              path: input.path,
              environmentId: ENV_B,
              rootPath: "/repo/b",
              entries: [],
            },
    };
    const slot = renderPanel(rpcValue);
    await waitFor(() => expect(resolveFirst).toBeDefined());

    slot.lifecycle.rerender(
      <WorkspaceExplorerPanel threadId={THREAD_B} params={null} />,
    );
    await act(async () => {
      resolveFirst({
        path: "",
        environmentId: ENV_A,
        rootPath: "C:" + BS + "repo",
        entries: [
          { kind: "file", name: "late-from-thread-a.txt", relativePath: "late-from-thread-a.txt" },
        ],
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("late-from-thread-a.txt")).toBeNull();
  });
});
