import { describe, expect, it, vi } from "vitest";
import { resolveBuiltInComposerMention } from "./plugin-composer-mentions";

type ComposerMentionClient = NonNullable<
  Parameters<typeof resolveBuiltInComposerMention>[2]
>;

function createClient(): ComposerMentionClient {
  return {
    environments: {
      paths: vi.fn(async () => ({ paths: [] })),
    },
    projects: {
      get: vi.fn(async ({ projectId }: { projectId: string }) => ({
        id: projectId,
        name: "Canonical project",
      })),
      paths: vi.fn(async () => ({ paths: [] })),
    },
    threadSections: {
      get: vi.fn(async ({ sectionId }: { sectionId: string }) => ({
        id: sectionId,
        name: "Canonical section",
      })),
    },
    threads: {
      get: vi.fn(async () => ({
        environmentId: "env_1",
        projectId: "proj_1",
      })),
      resolveMentions: vi.fn(async () => [
        {
          threadId: "thr_1",
          projectId: "proj_1",
          label: "Canonical thread",
        },
      ]),
      storagePaths: vi.fn(async () => ({ paths: [] })),
    },
  };
}

describe("resolveBuiltInComposerMention", () => {
  it("resolves canonical labels for thread, project, and section mentions", async () => {
    const client = createClient();
    const scope = { kind: "thread", threadId: "thr_context" } as const;

    await expect(
      resolveBuiltInComposerMention(
        { kind: "thread", threadId: "thr_1" },
        scope,
        client,
      ),
    ).resolves.toEqual({
      kind: "thread",
      threadId: "thr_1",
      projectId: "proj_1",
      label: "Canonical thread",
    });
    await expect(
      resolveBuiltInComposerMention(
        { kind: "project", projectId: "proj_1" },
        scope,
        client,
      ),
    ).resolves.toEqual({
      kind: "project",
      projectId: "proj_1",
      label: "Canonical project",
    });
    await expect(
      resolveBuiltInComposerMention(
        { kind: "section", sectionId: "sec_1" },
        scope,
        client,
      ),
    ).resolves.toEqual({
      kind: "section",
      sectionId: "sec_1",
      label: "Canonical section",
    });
  });

  it("uses the current thread environment for workspace paths", async () => {
    const client = createClient();
    const environmentPaths = vi.fn(
      async (
        _args: Parameters<ComposerMentionClient["environments"]["paths"]>[0],
      ) => ({
        paths: [
          { kind: "file" as const, path: "src/index.ts", name: "index.ts" },
        ],
      }),
    );
    client.environments.paths = environmentPaths;

    await expect(
      resolveBuiltInComposerMention(
        { kind: "path", source: "workspace", path: "src/index.ts" },
        { kind: "thread", threadId: "thr_context" },
        client,
      ),
    ).resolves.toEqual({
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "src/index.ts",
      label: "index.ts",
    });
    expect(client.threads.get).toHaveBeenCalledWith({
      threadId: "thr_context",
    });
    expect(environmentPaths).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: "env_1",
        query: "src/index.ts",
      }),
    );
  });

  it("uses the selected new-thread environment instead of the project default", async () => {
    const client = createClient();
    const environmentPaths = vi.fn(
      async (
        _args: Parameters<ComposerMentionClient["environments"]["paths"]>[0],
      ) => ({
        paths: [
          { kind: "file" as const, path: "worktree.txt", name: "worktree.txt" },
        ],
      }),
    );
    client.environments.paths = environmentPaths;

    await expect(
      resolveBuiltInComposerMention(
        { kind: "path", source: "workspace", path: "worktree.txt" },
        { kind: "new-thread", projectId: "proj_1" },
        client,
        {
          projectId: "proj_1",
          environmentId: "env_selected",
          hostId: null,
          threadStorageThreadId: null,
        },
      ),
    ).resolves.toMatchObject({
      kind: "path",
      path: "worktree.txt",
      label: "worktree.txt",
    });
    expect(environmentPaths).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: "env_selected" }),
    );
    expect(client.projects.paths).not.toHaveBeenCalled();
  });

  it("uses the active side-chat thread for thread-storage paths", async () => {
    const client = createClient();
    const storagePaths = vi.fn(
      async (
        _args: Parameters<ComposerMentionClient["threads"]["storagePaths"]>[0],
      ) => ({
        paths: [
          { kind: "directory" as const, path: "reports", name: "reports" },
        ],
      }),
    );
    client.threads.storagePaths = storagePaths;

    await expect(
      resolveBuiltInComposerMention(
        { kind: "path", source: "thread-storage", path: "reports" },
        {
          kind: "side-chat",
          projectId: "proj_1",
          parentThreadId: "thr_parent",
          tabId: "tab_1",
          childThreadId: "thr_child",
        },
        client,
      ),
    ).resolves.toEqual({
      kind: "path",
      source: "thread-storage",
      entryKind: "directory",
      path: "reports",
      label: "reports",
    });
    expect(storagePaths).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thr_child", query: "reports" }),
    );
  });

  it("rejects absolute and unresolved paths", async () => {
    const client = createClient();
    const scope = { kind: "new-thread", projectId: "proj_1" } as const;

    await expect(
      resolveBuiltInComposerMention(
        { kind: "path", source: "workspace", path: "/tmp/file.txt" },
        scope,
        client,
      ),
    ).rejects.toThrow("must be relative");
    await expect(
      resolveBuiltInComposerMention(
        { kind: "path", source: "workspace", path: "../file.txt" },
        scope,
        client,
      ),
    ).rejects.toThrow("must stay within");
    await expect(
      resolveBuiltInComposerMention(
        { kind: "path", source: "workspace", path: "missing.txt" },
        scope,
        client,
      ),
    ).rejects.toThrow("could not be resolved");
  });
});
