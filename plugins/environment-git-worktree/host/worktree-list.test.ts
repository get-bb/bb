import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWorktreeEntry,
  parseWorktreeListPorcelain,
  selectAdoptableWorktrees,
} from "./worktree-list.js";

function nativePath(path: string): string {
  return path.split("/").join(sep);
}

function record(fields: string[]): string {
  return `${fields.join("\0")}\0\0`;
}

describe("parseWorktreeListPorcelain", () => {
  it("reads the main checkout, branches, detached heads and bare repositories", () => {
    const stdout = [
      record(["worktree /repo", "HEAD abc123", "branch refs/heads/main"]),
      record(["worktree /repo/../feature", "HEAD def456", "detached"]),
      record([
        "worktree /elsewhere/wt",
        "HEAD 789abc",
        "branch refs/heads/fix/spaces are fine",
      ]),
      record(["worktree /bare", "bare"]),
    ].join("");

    expect(parseWorktreeListPorcelain(stdout)).toEqual([
      {
        path: nativePath("/repo"),
        branch: "main",
        isMain: true,
        isBare: false,
        locked: false,
        prunable: false,
      },
      {
        path: nativePath("/repo/../feature"),
        branch: null,
        isMain: false,
        isBare: false,
        locked: false,
        prunable: false,
      },
      {
        path: nativePath("/elsewhere/wt"),
        branch: "fix/spaces are fine",
        isMain: false,
        isBare: false,
        locked: false,
        prunable: false,
      },
      {
        path: nativePath("/bare"),
        branch: null,
        isMain: false,
        isBare: true,
        locked: false,
        prunable: false,
      },
    ]);
  });

  it("reads lock and prune state with and without a reason", () => {
    const stdout = [
      record(["worktree /repo", "branch refs/heads/main"]),
      record(["worktree /locked", "branch refs/heads/a", "locked"]),
      record([
        "worktree /prunable",
        "branch refs/heads/b",
        "prunable gitdir file points to non-existent location",
      ]),
    ].join("");

    const entries = parseWorktreeListPorcelain(stdout);
    expect(entries[1]?.locked).toBe(true);
    expect(entries[2]?.prunable).toBe(true);
  });

  it("returns nothing for empty output", () => {
    expect(parseWorktreeListPorcelain("")).toEqual([]);
  });

  it("keeps a path containing spaces intact", () => {
    const stdout = record([
      "worktree /Users/a/My Code/repo wt",
      "branch refs/heads/main",
    ]);
    expect(parseWorktreeListPorcelain(stdout)[0]?.path).toBe(
      nativePath("/Users/a/My Code/repo wt"),
    );
  });
  it("finds a registered worktree beyond the default listing limit", () => {
    const targetPath = nativePath("/target");
    const stdout = [
      ...Array.from({ length: 500 }, (_, index) =>
        record([
          `worktree /repo-${index}`,
          `branch refs/heads/branch-${index}`,
        ]),
      ),
      record(["worktree /target", "branch refs/heads/bb/target"]),
    ].join("");

    const limitedEntries = parseWorktreeListPorcelain(stdout);
    expect(limitedEntries).toHaveLength(500);
    expect(findWorktreeEntry(limitedEntries, targetPath)).toBeNull();

    const allEntries = parseWorktreeListPorcelain(stdout, Infinity);
    expect(allEntries).toHaveLength(501);
    expect(findWorktreeEntry(allEntries, targetPath)).toMatchObject({
      path: targetPath,
      branch: "bb/target",
      isMain: false,
    });
  });
});

describe("selectAdoptableWorktrees", () => {
  const managedRoot =
    "/home/u/.bb/plugins/environment-git-worktree/host-data/worktrees";

  it("keeps user-created worktrees and drops the main checkout, bare repos and bb's own", () => {
    const entries = parseWorktreeListPorcelain(
      [
        record(["worktree /code/repo", "branch refs/heads/main"]),
        record(["worktree /code/repo-feature", "branch refs/heads/feature"]),
        record([
          `worktree ${managedRoot}/thr_abc-1/repo`,
          "branch refs/heads/bb/task",
        ]),
        record(["worktree /code/bare", "bare"]),
      ].join(""),
    );

    expect(
      selectAdoptableWorktrees({ entries, managedRoot }).map((e) => e.path),
    ).toEqual([nativePath("/code/repo-feature")]);
  });

  it("does not treat a sibling of the managed root as managed", () => {
    const entries = parseWorktreeListPorcelain(
      [
        record(["worktree /code/repo", "branch refs/heads/main"]),
        record([
          `worktree ${managedRoot}-backup/thr_abc/repo`,
          "branch refs/heads/x",
        ]),
      ].join(""),
    );

    expect(
      selectAdoptableWorktrees({ entries, managedRoot }).map((e) => e.path),
    ).toEqual([nativePath(`${managedRoot}-backup/thr_abc/repo`)]);
  });
});
