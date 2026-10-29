import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import parcelWatcher from "@parcel/watcher";
import { createHostWatcher } from "@bb/host-watcher";
import { provisionWorkspace } from "@bb/host-workspace";
import { createDeferredPromise, initRepo, makeTempDir } from "@bb/test-helpers";
import { expect, it, vi } from "vitest";
import { WatchManager } from "./watch-manager.js";

vi.mock("@parcel/watcher", () => ({ default: { subscribe: vi.fn() } }));

const execFileAsync = promisify(execFile);

it("reconciles content and branch changed between ignore discovery and root watch readiness", async () => {
  const root = await fs.realpath(
    await initRepo(await makeTempDir("bb-watch-startup-")),
  );
  const workspace = await provisionWorkspace({ path: root });
  const rootSubscriptionStarted = createDeferredPromise<void>();
  const activateRootSubscription = createDeferredPromise<void>();
  vi.mocked(parcelWatcher.subscribe).mockImplementation(async (directory) => {
    if (directory === root) {
      rootSubscriptionStarted.resolve();
      await activateRootSubscription.promise;
    }
    return { unsubscribe: async () => undefined };
  });
  const onWorkspaceMetadataChanged = vi.fn();
  const reportedStatuses: Promise<{ stdout: string }>[] = [];
  const onWorkspaceStatusChanged = vi.fn(() => {
    reportedStatuses.push(
      execFileAsync("git", ["status", "--porcelain"], { cwd: root }),
    );
  });
  const onWorkspaceStatusWatchError = vi.fn();
  const manager = new WatchManager({
    hostWatcher: createHostWatcher(),
    provisionWorkspace: async () => workspace,
    onWorkspaceMetadataChanged,
    onWorkspaceStatusChanged,
    onWorkspaceStatusWatchError,
  });
  try {
    await manager.replaceWatchSet({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: "env-watch",
          workspaceContext: { workspacePath: root },
        },
      ],
      threadStorageTargets: [],
    });
    await rootSubscriptionStarted.promise;
    await fs.writeFile(
      path.join(root, "README.md"),
      "changed before watching\n",
    );
    await execFileAsync("git", ["checkout", "-b", "feature"], { cwd: root });
    activateRootSubscription.resolve();

    await vi.waitFor(() =>
      expect(onWorkspaceStatusChanged).toHaveBeenCalledWith({
        environmentId: "env-watch",
        changeKinds: ["work-status-changed"],
      }),
    );
    const statuses = await Promise.all(reportedStatuses);
    expect(statuses[0]?.stdout).toBe(" M README.md\n");
    await vi.waitFor(() =>
      expect(onWorkspaceMetadataChanged).toHaveBeenCalledWith({
        environmentId: "env-watch",
        workspace: {
          path: root,
          isGitRepo: true,
          isWorktree: false,
          branchName: "feature",
          defaultBranch: "main",
        },
      }),
    );
    expect(onWorkspaceStatusWatchError).not.toHaveBeenCalled();
  } finally {
    activateRootSubscription.resolve();
    await manager.shutdown();
    await Promise.allSettled(reportedStatuses);
    vi.mocked(parcelWatcher.subscribe).mockReset();
  }
});
