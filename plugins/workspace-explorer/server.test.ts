import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server";

const THREAD_ID = "thr_100000000000000000000001";
const ENV_ID = "env_1000000000000000000000001";
const HOST_A = "mach_100000000000000000000001";
const HOST_B = "mach_200000000000000000000002";

function setup(options: {
  environmentId?: string | null;
  environmentPath?: string | null;
  environmentHostId?: string;
  directoryEntries?: Array<{ kind: "directory" | "file"; name: string; path: string }>;
  directoryFor?: string;
}) {
  const directory = vi.fn(async ({ path }: { path?: string }) => ({
    directory: options.directoryFor ?? path ?? "C:\\repo",
    entries: options.directoryEntries ?? [],
    parent: null,
  }));
  const threadsGet = vi.fn(async () => ({
    id: THREAD_ID,
    environmentId:
      options.environmentId === undefined ? ENV_ID : options.environmentId,
  }));
  const environmentsGet = vi.fn(async () => ({
    id: ENV_ID,
    name: "main worktree",
    path: options.environmentPath === undefined ? "C:\\repo" : options.environmentPath,
    hostId: options.environmentHostId ?? HOST_A,
  }));
  const { bb, harness } = createFakePluginHost({
    pluginId: "workspace-explorer-test",
    sdk: {
      threads: { get: threadsGet },
      environments: { get: environmentsGet },
      hosts: { directory },
    },
  });
  void plugin(bb);
  return { harness, directory, threadsGet, environmentsGet };
}

describe("explorerRoot", () => {
  it("resolves the thread environment workspace with its host", async () => {
    const { harness } = setup({});
    const result = (await harness.callRpc("explorerRoot", {
      threadId: THREAD_ID,
    })) as Record<string, unknown>;
    expect(result).toEqual({
      status: "ready",
      environmentId: ENV_ID,
      environmentName: "main worktree",
      hostId: HOST_A,
      rootPath: "C:\\repo",
    });
  });

  it("reports threads without an environment honestly", async () => {
    const { harness } = setup({ environmentId: null });
    const result = await harness.callRpc("explorerRoot", {
      threadId: THREAD_ID,
    });
    expect(result).toEqual({ status: "no-environment" });
  });

  it("reports environments without a workspace path honestly", async () => {
    const { harness } = setup({ environmentPath: null });
    const result = await harness.callRpc("explorerRoot", {
      threadId: THREAD_ID,
    });
    expect(result).toEqual({ status: "no-workspace-path" });
  });
});

describe("explorerList", () => {
  it("lists immediate children as workspace-relative paths for a posix host", async () => {
    const { harness, directory } = setup({
      environmentPath: "/home/user/repo",
      environmentHostId: HOST_B,
      directoryFor: "/home/user/repo",
      directoryEntries: [
        { kind: "directory", name: "src", path: "/home/user/repo/src" },
        { kind: "file", name: "README.md", path: "/home/user/repo/README.md" },
      ],
    });

    const result = (await harness.callRpc("explorerList", {
      threadId: THREAD_ID,
      path: "",
    })) as {
      path: string;
      environmentId: string;
      rootPath: string;
      entries: Array<{ kind: string; name: string; relativePath: string }>;
    };

    expect(directory).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: HOST_B, path: "/home/user/repo" }),
    );
    expect(result.environmentId).toBe(ENV_ID);
    expect(result.rootPath).toBe("/home/user/repo");
    expect(result.entries).toEqual([
      { kind: "directory", name: "src", relativePath: "src" },
      { kind: "file", name: "README.md", relativePath: "README.md" },
    ]);
  });

  it("lists a nested folder with slash-relative children", async () => {
    const { harness, directory } = setup({
      directoryFor: "C:\\repo\\src",
      directoryEntries: [
        { kind: "file", name: "child.txt", path: "C:\\repo\\src\\child.txt" },
        { kind: "file", name: "outside.txt", path: "D:\\other\\outside.txt" },
      ],
    });

    const result = (await harness.callRpc("explorerList", {
      threadId: THREAD_ID,
      path: "src",
    })) as {
      environmentId: string;
      rootPath: string;
      entries: Array<{ name: string; relativePath: string }>;
    };

    expect(directory).toHaveBeenCalledWith(
      expect.objectContaining({ path: "C:\\repo\\src" }),
    );
    expect(result.entries).toEqual([
      { kind: "file", name: "child.txt", relativePath: "src/child.txt" },
    ]);
    expect(result.environmentId).toBe(ENV_ID);
    expect(result.rootPath).toBe("C:\\repo");
  });

  it("rejects traversal and absolute paths without listing", async () => {
    const { harness, directory } = setup({});
    await expect(
      harness.callRpc("explorerList", {
        threadId: THREAD_ID,
        path: "a/../../b",
      }),
    ).rejects.toThrow(/relative to the workspace root/);
    await expect(
      harness.callRpc("explorerList", {
        threadId: THREAD_ID,
        path: "C:\\Windows",
      }),
    ).rejects.toThrow(/relative to the workspace root/);
    expect(directory).not.toHaveBeenCalled();
  });

  it("refuses to list when the thread has no environment workspace", async () => {
    const { harness, directory } = setup({ environmentId: null });
    await expect(
      harness.callRpc("explorerList", { threadId: THREAD_ID, path: "" }),
    ).rejects.toThrow(/no environment workspace/);
    expect(directory).not.toHaveBeenCalled();
  });
});
