import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  type ExperimentalFakeHostRpcCall,
} from "@get-bb/plugin-sdk/testing";
import { makeWorkspaceMergeBase, makeWorkspaceStatus } from "../testing.js";
import { describe, expect, it } from "vitest";
import plugin from "../server.js";

type Environment = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["get"]>
>;

const ENVIRONMENT = {
  id: "env-1",
  name: null,
  projectId: "project-1",
  hostId: "host-1",
  path: "/work/env-1",
  isGitRepo: true,
  isWorktree: true,
  branchName: "feature",
  baseBranch: null,
  defaultBranch: "main",
  mergeBaseBranch: null,
  status: "ready",
  environmentProviderId: "git-worktree",
  lifecycle: { phase: "active", retireAt: null, teardown: null },
  hostLifecycle: "active",
  environmentProviderSelection: null,
  environmentProviderInstanceKey: null,
  managed: true,
  workspaceProvisionType: "worktree",
} as Environment;

const VIEWED_FILES = [{ path: "src/a.ts", revision: "rev-a" }];

function unexpectedHostCall(call: ExperimentalFakeHostRpcCall): never {
  throw new Error(`unexpected host call ${call.method}`);
}

function setup(
  host: (call: ExperimentalFakeHostRpcCall) => unknown,
  options: {
    environment?: Environment;
    viewedFiles?: { path: string; revision: string }[];
    file?: {
      path: string;
      content: string;
      contentEncoding: "utf8" | "base64";
      mimeType: string;
      sizeBytes: number;
    };
  } = {},
) {
  const viewedCalls: { method: string; args: unknown }[] = [];
  const fileReads: unknown[] = [];
  const fake = createFakePluginHost({
    pluginId: "bb--git",
    sdk: {
      environments: {
        get: async () => options.environment ?? ENVIRONMENT,
        experimental_diffViewed: async (args: unknown) => {
          viewedCalls.push({ method: "list", args });
          return { files: options.viewedFiles ?? VIEWED_FILES };
        },
        experimental_markDiffViewed: async (args: unknown) => {
          viewedCalls.push({ method: "mark", args });
          return { ok: true };
        },
        experimental_clearDiffViewed: async (args: unknown) => {
          viewedCalls.push({ method: "clear", args });
          return { ok: true };
        },
      },
      files: {
        read: async (args: unknown) => {
          fileReads.push(args);
          if (options.file === undefined) throw new Error("unexpected read");
          return options.file;
        },
      },
    },
    experimental_callHostRpc: host,
  });
  plugin(fake.bb);
  return { fake, viewedCalls, fileReads };
}

async function stdout(
  fake: ReturnType<typeof setup>["fake"],
  argv: string[],
): Promise<string> {
  const result = await fake.harness.runCli(argv);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

const dirtyStatus = makeWorkspaceStatus({
  workingTree: {
    hasUncommittedChanges: true,
    state: "dirty_uncommitted",
    insertions: 4,
    deletions: 1,
    lineStatsComplete: true,
    fileCount: 1,
    files: [{ path: "README.md", status: "M", insertions: 4, deletions: 1 }],
  },
  mergeBase: makeWorkspaceMergeBase({
    aheadCount: 2,
    behindCount: 3,
    squashMergeCheckComplete: false,
  }),
});

const changedFile = {
  revision: "100644:aaa:100644:bbb",
  loadMode: "auto",
  origin: "tracked",
  binary: false,
  deletions: 1,
  additions: 2,
  changeKind: "modified",
  previousPath: null,
  path: "src/a.ts",
};

function filesHost() {
  return {
    outcome: "available",
    value: {
      initialPatches: [
        {
          truncated: false,
          patch: "@@ -1 +1 @@\n-old\n+new\n",
          path: "src/a.ts",
        },
      ],
      mergeBaseRef: null,
      shortstat: " 1 file changed, 2 insertions(+), 1 deletion(-)\n",
      truncated: false,
      files: [
        changedFile,
        {
          ...changedFile,
          path: "logo.png",
          previousPath: "old-logo.png",
          changeKind: "renamed",
          additions: 0,
          deletions: 0,
          binary: true,
          loadMode: "on_demand",
          revision: "100644:ccc:100644:ddd",
        },
      ],
    },
  };
}

describe("bb git", () => {
  it("prints status against the requested merge base and qualifies incomplete counts", async () => {
    const { fake } = setup(() => ({
      outcome: "available",
      value: dirtyStatus,
    }));
    expect(
      await stdout(fake, ["status", "env-1", "--merge-base-branch", "main"]),
    ).toBe(
      [
        "State: dirty_uncommitted",
        "Branch: main",
        "Default branch: main",
        "Changed files: 1",
        "Insertions: +4",
        "Deletions: -1",
        "Merge base: main",
        "Squash-merge check incomplete; counts may include already-merged commits.",
        "Ahead: 2",
        "Behind: 3",
        "",
      ].join("\n"),
    );
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      { method: "status", input: { mergeBaseBranch: "main" } },
    ]);
  });

  it("does not print line totals that untracked files leave incomplete", async () => {
    const { fake } = setup(() => ({
      outcome: "available",
      value: makeWorkspaceStatus({
        workingTree: { ...dirtyStatus.workingTree, lineStatsComplete: false },
      }),
    }));
    expect(await stdout(fake, ["status", "env-1"])).toBe(
      [
        "State: dirty_uncommitted",
        "Branch: main",
        "Default branch: main",
        "Changed files: 1",
        "Line stats: unavailable for untracked files",
        "",
      ].join("\n"),
    );
  });

  it("explains non-git environments", async () => {
    const { fake } = setup(
      () => {
        throw new Error("non-git environments do not reach the host");
      },
      { environment: { ...ENVIRONMENT, isGitRepo: false } },
    );
    expect(await stdout(fake, ["status", "env-1"])).toBe(
      "Status unavailable: Workspace status is not available for non-git environments\n",
    );
  });

  it("prints status JSON in the workspace schema's key order", async () => {
    const { fake } = setup(() => ({
      outcome: "available",
      value: dirtyStatus,
    }));
    const output = await stdout(fake, [
      "status",
      "env-1",
      "--merge-base-branch",
      "main",
      "--json",
    ]);
    expect(output.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(output);
    expect(output).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    expect(Object.keys(parsed)).toEqual(["outcome", "workspace"]);
    expect(Object.keys(parsed.workspace)).toEqual([
      "workingTree",
      "checkout",
      "branch",
      "mergeBase",
    ]);
    expect(Object.keys(parsed.workspace.workingTree)).toEqual([
      "insertions",
      "deletions",
      "lineStatsComplete",
      "fileCount",
      "files",
      "hasUncommittedChanges",
      "state",
    ]);
    expect(Object.keys(parsed.workspace.mergeBase)).toEqual([
      "insertions",
      "deletions",
      "lineStatsComplete",
      "fileCount",
      "files",
      "mergeBaseBranch",
      "baseRef",
      "aheadCount",
      "behindCount",
      "squashMergeCheckComplete",
      "hasCommittedUnmergedChanges",
      "commits",
    ]);
  });

  it("lists local and remote branches with truncation", async () => {
    const { fake } = setup(() => ({
      branches: ["main", "release"],
      branchesTruncated: false,
      remoteBranches: [],
      remoteBranchesTruncated: true,
      selectedBranch: null,
    }));
    expect(
      await stdout(fake, [
        "branches",
        "env-1",
        "--query",
        "main",
        "--limit",
        "20",
      ]),
    ).toBe(
      [
        "Local branches:",
        "  main",
        "  release",
        "Remote branches:",
        "  (none)",
        "  (truncated)",
        "",
      ].join("\n"),
    );
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      { method: "branches", input: { query: "main", limit: 20 } },
    ]);
  });

  it("prints a diff whose patch ends in a newline with the blank line console.log left", async () => {
    const { fake } = setup(() => ({
      outcome: "available",
      value: {
        files: "M\tREADME.md\n",
        shortstat: " 1 file changed, 1 insertion(+)\n",
        diff: "diff --git a/README.md b/README.md\n+new\n",
        truncated: false,
        mergeBaseRef: "abc123",
      },
    }));
    expect(
      await stdout(fake, [
        "diff",
        "env-1",
        "--target",
        "all",
        "--merge-base-branch",
        "main",
      ]),
    ).toBe(
      "M\tREADME.md\n1 file changed, 1 insertion(+)\ndiff --git a/README.md b/README.md\n+new\n\n",
    );
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      {
        method: "diff",
        input: { target: { type: "all", mergeBaseBranch: "main" } },
      },
    ]);
  });

  it("prints a truncated diff and nothing for an empty one", async () => {
    const truncated = setup(() => ({
      outcome: "available",
      value: {
        files: "",
        shortstat: "",
        diff: "diff --git a/README.md b/README.md",
        truncated: true,
        mergeBaseRef: null,
      },
    }));
    expect(
      await stdout(truncated.fake, [
        "diff",
        "env-1",
        "--target",
        "uncommitted",
      ]),
    ).toBe("diff --git a/README.md b/README.md\n(diff truncated)\n");

    const empty = setup(() => ({
      outcome: "available",
      value: {
        files: "",
        shortstat: "",
        diff: "",
        truncated: false,
        mergeBaseRef: null,
      },
    }));
    expect(
      await stdout(empty.fake, ["diff", "env-1", "--target", "uncommitted"]),
    ).toBe("");
  });

  it("prints diff JSON in the diff schema's key order", async () => {
    const { fake } = setup(() => ({
      outcome: "available",
      value: {
        mergeBaseRef: null,
        files: "M\tREADME.md\n",
        shortstat: " 1 file changed\n",
        truncated: false,
        diff: "+new\n",
      },
    }));
    expect(
      await stdout(fake, [
        "diff",
        "env-1",
        "--target",
        "uncommitted",
        "--json",
      ]),
    ).toBe(
      `${JSON.stringify(
        {
          outcome: "available",
          diff: {
            diff: "+new\n",
            truncated: false,
            shortstat: " 1 file changed\n",
            files: "M\tREADME.md\n",
            mergeBaseRef: null,
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("lists changed files with renames, binary stats and the shortstat", async () => {
    const { fake } = setup(filesHost);
    expect(
      await stdout(fake, ["files", "env-1", "--target", "uncommitted"]),
    ).toBe(
      [
        "modified\t+2 -1\ttracked\tauto\tsrc/a.ts",
        "renamed\tbinary\ttracked\ton_demand\told-logo.png -> logo.png",
        "1 file changed, 2 insertions(+), 1 deletion(-)",
        "",
      ].join("\n"),
    );
  });

  it("prints files JSON in the key order the environment route used", async () => {
    const { fake } = setup(filesHost);
    const output = await stdout(fake, [
      "files",
      "env-1",
      "--target",
      "uncommitted",
      "--json",
    ]);
    const entry = {
      path: "src/a.ts",
      previousPath: null,
      changeKind: "modified",
      additions: 2,
      deletions: 1,
      binary: false,
      origin: "tracked",
      loadMode: "auto",
      revision: "100644:aaa:100644:bbb",
    };
    expect(output).toBe(
      `${JSON.stringify(
        {
          outcome: "available",
          files: [
            entry,
            {
              path: "logo.png",
              previousPath: "old-logo.png",
              changeKind: "renamed",
              additions: 0,
              deletions: 0,
              binary: true,
              origin: "tracked",
              loadMode: "on_demand",
              revision: "100644:ccc:100644:ddd",
            },
          ],
          shortstat: " 1 file changed, 2 insertions(+), 1 deletion(-)\n",
          mergeBaseRef: null,
          initialPatches: [
            {
              path: "src/a.ts",
              patch: "@@ -1 +1 @@\n-old\n+new\n",
              truncated: false,
            },
          ],
          truncated: false,
        },
        null,
        2,
      )}\n`,
    );
  });

  it("prints a text file side with the newline console.log appended", async () => {
    const { fake, fileReads } = setup(unexpectedHostCall, {
      file: {
        path: "/work/env-1/README.md",
        content: "# Title\n",
        contentEncoding: "utf8",
        mimeType: "text/markdown",
        sizeBytes: 8,
      },
    });
    expect(
      await stdout(fake, [
        "file",
        "env-1",
        "--target",
        "uncommitted",
        "--path",
        "README.md",
        "--side",
        "old",
      ]),
    ).toBe("# Title\n\n");
    expect(fileReads).toEqual([
      {
        hostId: "host-1",
        path: "/work/env-1/README.md",
        rootPath: "/work/env-1",
        ref: "HEAD",
      },
    ]);
  });

  it("prints an empty text file side as one empty line", async () => {
    const { fake } = setup(unexpectedHostCall, {
      file: {
        path: "/work/env-1/empty.txt",
        content: "",
        contentEncoding: "utf8",
        mimeType: "text/plain",
        sizeBytes: 0,
      },
    });
    expect(
      await stdout(fake, [
        "file",
        "env-1",
        "--target",
        "uncommitted",
        "--path",
        "empty.txt",
        "--side",
        "new",
      ]),
    ).toBe("\n");
  });

  it("describes a binary file side before its base64 content", async () => {
    const { fake } = setup(unexpectedHostCall, {
      file: {
        path: "/work/env-1/logo.png",
        content: "AAEC",
        contentEncoding: "base64",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    });
    expect(
      await stdout(fake, [
        "file",
        "env-1",
        "--target",
        "commit",
        "--sha",
        "abc1234",
        "--path",
        "logo.png",
        "--side",
        "new",
      ]),
    ).toBe(
      [
        "Binary file: /work/env-1/logo.png",
        "Encoding: base64",
        "Size: 3 bytes",
        "MIME type: image/png",
        "AAEC",
        "",
      ].join("\n"),
    );
  });

  it("prints patches with truncation and forwards whitespace mode", async () => {
    const { fake } = setup(() => ({
      outcome: "available",
      value: {
        patches: [
          {
            path: "src/a.ts",
            patch: "@@ -1 +1 @@\n-old\n+new\n",
            truncated: false,
          },
          { path: "src/b.ts", patch: "@@ -1 +1 @@\n", truncated: true },
          {
            path: "src/c.ts",
            patch: "@@ -2 +2 @@\n-x\n+y\n",
            truncated: false,
          },
        ],
        deferred: [],
      },
    }));
    expect(
      await stdout(fake, [
        "patch",
        "env-1",
        "--target",
        "uncommitted",
        "--path",
        "src/a.ts",
        "--path",
        "src/b.ts",
        "--path",
        "src/c.ts",
        "--ignore-whitespace",
      ]),
    ).toBe(
      [
        "File: src/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
        "File: src/b.ts",
        "@@ -1 +1 @@",
        "",
        "(patch truncated)",
        "File: src/c.ts",
        "@@ -2 +2 @@",
        "-x",
        "+y",
        "",
        "",
      ].join("\n"),
    );
    expect(fake.harness.experimental_hostRpcCalls).toMatchObject([
      {
        method: "patches",
        input: {
          paths: ["src/a.ts", "src/b.ts", "src/c.ts"],
          ignoreWhitespace: true,
        },
      },
    ]);
  });

  it("lists Viewed files and says so when there are none", async () => {
    const marked = setup(() => {
      throw new Error("viewed reads do not reach the host");
    });
    expect(
      await stdout(marked.fake, [
        "viewed",
        "list",
        "env-1",
        "--target",
        "uncommitted",
      ]),
    ).toBe("rev-a\tsrc/a.ts\n");

    const none = setup(
      () => {
        throw new Error("viewed reads do not reach the host");
      },
      { viewedFiles: [] },
    );
    expect(
      await stdout(none.fake, [
        "viewed",
        "list",
        "env-1",
        "--target",
        "uncommitted",
      ]),
    ).toBe("No files marked Viewed.\n");
    expect(
      await stdout(none.fake, [
        "viewed",
        "list",
        "env-1",
        "--target",
        "uncommitted",
        "--json",
      ]),
    ).toBe('{\n  "files": []\n}\n');
  });

  it("marks a file Viewed at its current revision", async () => {
    const { fake, viewedCalls } = setup(filesHost);
    expect(
      await stdout(fake, [
        "viewed",
        "mark",
        "env-1",
        "--target",
        "uncommitted",
        "--path",
        "src/a.ts",
      ]),
    ).toBe("Viewed state updated.\n");
    expect(viewedCalls).toEqual([
      {
        method: "mark",
        args: {
          environmentId: "env-1",
          target: { type: "uncommitted" },
          path: "src/a.ts",
          revision: "100644:aaa:100644:bbb",
        },
      },
    ]);
  });

  it("rejects a commit target without a SHA before reading git", async () => {
    const { fake } = setup(() => {
      throw new Error("should not read git");
    });
    const result = await fake.harness.runCli([
      "diff",
      "env-1",
      "--target",
      "commit",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "Error: --sha is required when --target commit is used.\n",
    );
    expect(fake.harness.experimental_hostRpcCalls).toEqual([]);
  });
});

describe("bb git errors", () => {
  it("reports a missing environment with the old bb environment error envelope", async () => {
    const fake = createFakePluginHost({
      pluginId: "bb--git",
      sdk: {
        environments: {
          get: async () => {
            throw Object.assign(new Error("HTTP 404: Environment not found"), {
              status: 404,
            });
          },
        },
      },
    });
    plugin(fake.bb);
    const result = await fake.harness.runCli(["status", "env-gone", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("Error: Environment not found\n");
    expect(JSON.parse(result.stdout ?? "")).toEqual({
      ok: false,
      error: {
        code: "environment_not_found",
        message: "Environment not found",
      },
    });
  });
});
