import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  deriveRepoDirName,
  isBbManagedWorkspacePath,
  resolveManagedTargetPath,
} from "../../src/services/threads/worktree-paths.js";

describe("deriveRepoDirName", () => {
  it.each([
    ["local absolute path", "/Users/someone/code/my-repo", "my-repo"],
    [
      "local path with trailing slash",
      "/Users/someone/code/my-repo/",
      "my-repo",
    ],
    ["https URL", "https://github.com/octocat/Hello-World.git", "Hello-World"],
    ["ssh URL", "ssh://git@github.com/octocat/Hello-World.git", "Hello-World"],
    ["scp-style", "git@github.com:octocat/Hello-World.git", "Hello-World"],
    [
      "scp-style without .git",
      "git@github.com:octocat/Hello-World",
      "Hello-World",
    ],
    ["dotted name", "/Users/me/code/my.repo", "my.repo"],
  ])("derives %s", (_label, input, expected) => {
    expect(deriveRepoDirName(input)).toBe(expected);
  });

  it.each([
    ["root-only path", "/"],
    ["empty string", ""],
    ["bare .git", "/Users/me/code/.git"],
    ["parent traversal", "/Users/me/code/.."],
    ["current dir", "/Users/me/code/."],
    ["leading dash (could be interpreted as flag)", "/tmp/-dangerous"],
    ["whitespace in name", "/tmp/my repo"],
    [
      "url with query parameter encoded into basename",
      "https://host/foo/bar.git;param=x",
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => deriveRepoDirName(input)).toThrowError(ApiError);
  });
});

describe("isBbManagedWorkspacePath", () => {
  const dataDir = "C:\\Users\\me\\.bb";

  it("folds case on NTFS worktree paths", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: "c:\\users\\me\\.bb\\worktrees\\env_1\\repo",
      }),
    ).toBe(true);
  });

  it("treats a lexical .. alias as managed", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: "C:\\Users\\me\\.bb\\foo\\..\\worktrees\\env_1\\repo",
      }),
    ).toBe(true);
  });

  it("does not match a worktrees-evil sibling", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: "C:\\Users\\me\\.bb\\worktrees-evil\\env_1\\repo",
      }),
    ).toBe(false);
  });
});

describe("resolveManagedTargetPath", () => {
  it("joins Windows data dirs with backslashes even on a posix test host", () => {
    expect(
      resolveManagedTargetPath({
        dataDir: "C:\\Users\\me\\.bb",
        environmentId: "env_1",
        sourcePath: "C:\\src\\repo",
        hostPathKind: "windows",
      }),
    ).toBe("C:\\Users\\me\\.bb\\worktrees\\env_1\\repo");
  });
});

describe("resolveThreadStorageRootPath", () => {
  it("keeps a posix dataDir in the host dialect", async () => {
    const { resolveThreadStoragePathFromRoot, resolveThreadStorageRootPath } =
      await import("../../src/services/threads/thread-storage.js");
    expect(resolveThreadStorageRootPath({ dataDir: "/tmp/bb-host-data" })).toBe(
      "/tmp/bb-host-data/thread-storage",
    );
    expect(
      resolveThreadStoragePathFromRoot({
        threadId: "thr_1",
        threadStorageRootPath: "/tmp/bb-host-data/thread-storage",
      }),
    ).toBe("/tmp/bb-host-data/thread-storage/thr_1");
    expect(
      resolveThreadStorageRootPath({ dataDir: "C:\\Users\\me\\.bb" }),
    ).toBe("C:\\Users\\me\\.bb\\thread-storage");
  });
});
