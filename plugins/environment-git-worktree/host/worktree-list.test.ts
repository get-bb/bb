import { describe, expect, it } from "vitest";
import {
  parseWorktreeListPorcelain,
  selectAdoptableWorktrees,
} from "./worktree-list.js";

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
        path: "/repo",
        branch: "main",
        isMain: true,
        isBare: false,
        locked: false,
        prunable: false,
      },
      {
        path: "/repo/../feature",
        branch: null,
        isMain: false,
        isBare: false,
        locked: false,
        prunable: false,
      },
      {
        path: "/elsewhere/wt",
        branch: "fix/spaces are fine",
        isMain: false,
        isBare: false,
        locked: false,
        prunable: false,
      },
      {
        path: "/bare",
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
      "/Users/a/My Code/repo wt",
    );
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
    ).toEqual(["/code/repo-feature"]);
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
    ).toEqual([`${managedRoot}-backup/thr_abc/repo`]);
  });
});
