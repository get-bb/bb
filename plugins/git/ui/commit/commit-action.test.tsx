// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  experimental_useAppPanel,
  useBbNavigate,
  useSdk,
  type PluginThreadAction,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import {
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import { gitRpcContract } from "../../rpc-contract.js";
import type { WorkspaceStatus } from "../../contract.js";
import {
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "../../testing.js";
import { commitThreadAction } from "./commit-action.js";
import { CommitDialogOverlay } from "./CommitDialog.js";
import { closeCommitDialog, commit, openCommitDialog } from "./commit-store.js";

const toast = vi.hoisted(() => ({
  loading: vi.fn((_title: string, _options?: unknown) => "toast-1"),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
  cleanup();
  closeCommitDialog();
  vi.clearAllMocks();
});

const DIRTY = makeWorkspaceStatus({
  workingTree: makeWorkspaceWorkingTree({
    hasUncommittedChanges: true,
    state: "dirty_uncommitted",
    files: [{ path: "src/app.ts", status: "M", insertions: 3, deletions: 1 }],
    insertions: 3,
    deletions: 1,
  }),
  branch: { currentBranch: "feat/commit", defaultBranch: "main" },
});

function statusFor(workspace: WorkspaceStatus) {
  return {
    status: ({ keys }: { keys: string[] }) =>
      Object.fromEntries(
        keys.map((key) => [key, { outcome: "available" as const, workspace }]),
      ),
  } as Partial<PluginRpcTestHandlers<typeof gitRpcContract>>;
}

function target(
  overrides: Partial<PluginThreadActionTarget> = {},
): PluginThreadActionTarget {
  return {
    id: "thr-1",
    projectId: "proj-1",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    sectionId: null,
    isUnread: false,
    status: "idle",
    environment: { id: "env-1", path: "/work/env-1" },
    ...overrides,
  };
}

type ItemFor = (thread: PluginThreadActionTarget) => PluginThreadAction | null;

function Probe({ onItem }: { onItem(item: ItemFor): void }) {
  const data = commitThreadAction.useData!({ threadIds: ["thr-1"] });
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const experimental_panel = experimental_useAppPanel();
  useLayoutEffect(() => {
    onItem((thread) =>
      commitThreadAction.item({
        thread,
        data,
        sdk,
        navigate,
        experimental_panel,
      }),
    );
  });
  return null;
}

function renderAction({
  workspace = DIRTY,
  showGitChanges = true,
}: { workspace?: WorkspaceStatus; showGitChanges?: boolean } = {}) {
  let itemFor: ItemFor | null = null;
  const configChanged: (() => void)[] = [];
  const settings = { showGitChanges };
  const view = renderSlot(
    { component: Probe },
    {
      onItem: (next: ItemFor) => {
        itemFor = next;
      },
    },
    {
      rpc: statusFor(workspace) as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
      sdk: {
        system: {
          config: async () => ({
            generalSettings: { showGitChanges: settings.showGitChanges },
          }),
        },
        threads: { get: async () => ({ environmentId: "env-1" }) },
        subscribe: (args: { event: string; callback: () => void }) => {
          if (args.event === "system:config-changed") {
            configChanged.push(args.callback);
          }
          return () => {};
        },
      } as never,
    },
  );
  return {
    view,
    item: (overrides: Partial<PluginThreadActionTarget> = {}) =>
      itemFor?.(target(overrides)) ?? null,
    setShowGitChanges(value: boolean) {
      settings.showGitChanges = value;
      for (const callback of configChanged) callback();
    },
  };
}

describe("commit header action", () => {
  it("is a header action", () => {
    expect(commitThreadAction.placement).toBe("header");
  });

  it("offers Commit once the open thread's workspace has uncommitted changes", async () => {
    const action = renderAction();
    await waitFor(() => expect(action.item()?.label).toBe("Commit"));
    expect(action.item()?.icon).toBe("GitBranch");
  });

  it("hides Commit for a clean workspace, an archived thread, or no reusable environment", async () => {
    const clean = renderAction({ workspace: makeWorkspaceStatus() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(clean.item()).toBeNull();
    cleanup();
    const dirty = renderAction();
    await waitFor(() => expect(dirty.item()).not.toBeNull());
    expect(dirty.item({ archivedAt: 1 })).toBeNull();
    expect(dirty.item({ environment: null })).toBeNull();
    expect(dirty.item({ environment: { id: "env-2", path: "/x" } })).toBeNull();
  });

  it("follows the Show Git changes setting as it changes", async () => {
    const action = renderAction({ showGitChanges: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(action.item()).toBeNull();
    await act(async () => action.setShowGitChanges(true));
    await waitFor(() => expect(action.item()?.label).toBe("Commit"));
    await act(async () => action.setShowGitChanges(false));
    await waitFor(() => expect(action.item()).toBeNull());
  });
});

describe("commit", () => {
  function sdkWith(commitImpl: () => Promise<unknown>) {
    return { environments: { commit: vi.fn(commitImpl) } } as never;
  }

  it("shows the created commit", async () => {
    await commit(
      sdkWith(async () => ({
        ok: true,
        action: "commit",
        message: "Created commit abc",
        commitSha: "abcdef1234567",
        commitSubject: "Add commit",
      })),
      { threadId: "thr-1", environmentId: "env-1" },
    );
    expect(toast.loading).toHaveBeenCalledWith("Creating commit");
    expect(toast.success).toHaveBeenCalledWith(
      "Commit created",
      expect.objectContaining({ id: "toast-1" }),
    );
  });

  it("queues a second commit behind the first for the same thread", async () => {
    let finishFirst: () => void = () => {};
    const firstSdk = sdkWith(
      () =>
        new Promise((resolve) => {
          finishFirst = () =>
            resolve({ commitSha: "a".repeat(40), commitSubject: "One" });
        }),
    );
    const first = commit(firstSdk, {
      threadId: "thr-1",
      environmentId: "env-1",
    });
    const second = commit(
      sdkWith(async () => ({
        commitSha: "b".repeat(40),
        commitSubject: "Two",
      })),
      { threadId: "thr-1", environmentId: "env-1" },
    );
    expect(toast.loading.mock.calls.map(([title]) => title)).toEqual([
      "Creating commit",
      "Commit queued",
    ]);
    await vi.waitFor(() =>
      expect(
        (firstSdk as { environments: { commit: () => unknown } }).environments
          .commit,
      ).toHaveBeenCalled(),
    );
    finishFirst();
    await Promise.all([first, second]);
    expect(toast.loading.mock.calls.map(([title]) => title)).toEqual([
      "Creating commit",
      "Commit queued",
      "Creating commit",
    ]);
    expect(toast.success).toHaveBeenCalledTimes(2);
  });

  it("explains why the workspace refused the commit", async () => {
    const refusal = Object.assign(new Error("HTTP 409: not ready"), {
      status: 409,
      body: {
        code: "environment_not_ready",
        message: "Environment is not ready",
        details: { environmentStatus: "provisioning", hasPath: true },
      },
    });
    await commit(
      sdkWith(async () => {
        throw refusal;
      }),
      { threadId: "thr-1", environmentId: "env-1" },
    );
    expect(toast.error).toHaveBeenCalledWith("Commit failed", {
      id: "toast-1",
      description: "Commit failed. Workspace is still starting.",
    });
  });

  it("shows the server's message for other failures", async () => {
    const failure = Object.assign(new Error("HTTP 409: x"), {
      status: 409,
      body: { code: "no_changes", message: "No uncommitted changes to commit" },
    });
    await commit(
      sdkWith(async () => {
        throw failure;
      }),
      { threadId: "thr-1", environmentId: "env-1" },
    );
    expect(toast.error).toHaveBeenCalledWith("Commit failed", {
      id: "toast-1",
      description: "No uncommitted changes to commit",
    });
  });
});

describe("commit dialog", () => {
  it("shows the branch, status, and changed files, then commits and closes", async () => {
    const commitEnvironment = vi.fn(async () => ({
      commitSha: "c".repeat(40),
      commitSubject: "Three",
    }));
    renderSlot(
      { component: CommitDialogOverlay },
      {},
      {
        rpc: statusFor(DIRTY) as PluginRpcTestHandlers<typeof gitRpcContract>,
        experimental_rpcContract: gitRpcContract,
        pluginId: "bb--git",
        sdk: { environments: { commit: commitEnvironment } } as never,
      },
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openCommitDialog({ threadId: "thr-1", environmentId: "env-1" }));
    await screen.findByText("feat/commit");
    expect(screen.getByText("Dirty")).not.toBeNull();
    expect(screen.getByText("Uncommitted")).not.toBeNull();
    expect(screen.getByRole("dialog").textContent).toContain("app.ts");
    fireEvent.click(screen.getByRole("button", { name: "Commit changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(commitEnvironment).toHaveBeenCalledWith({ environmentId: "env-1" });
  });
});
