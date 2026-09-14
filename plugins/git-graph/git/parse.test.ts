import { describe, expect, it } from "vitest";
import {
  buildRefsByCommit,
  isUnbornHeadMessage,
  listBranchRefs,
  parseForEachRefOutput,
  parseLogOutput,
  parseNameStatus,
  parseStatusPorcelain,
} from "./parse.js";

const RS = "\x1e";
const US = "\x1f";

describe("parseLogOutput", () => {
  it("parses records with unicode subjects and multiple parents", () => {
    const raw =
      `${["c1", "c1a", "p1 p2", "Аня", "anya@example.com", "2026-09-01T10:00:00+03:00", "Fix naïve über-код"].join(US)}${RS}` +
      `${["p1", "p1a", "p0", "Bob", "bob@example.com", "2026-08-31T09:00:00Z", 'Root of "everything"'].join(US)}${RS}`;
    const commits = parseLogOutput(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: "c1",
      abbrev: "c1a",
      parents: ["p1", "p2"],
      authorName: "Аня",
      subject: "Fix naïve über-код",
    });
    expect(commits[1]?.parents).toEqual(["p0"]);
  });

  it("parses a root commit with no parents", () => {
    const raw = `${["r", "ra", "", "Bob", "b@e", "2026-01-01T00:00:00Z", "first"].join(US)}${RS}`;
    expect(parseLogOutput(raw)[0]?.parents).toEqual([]);
  });

  it("ignores empty records", () => {
    expect(parseLogOutput(`${RS}${RS}`)).toEqual([]);
  });
});

describe("parseForEachRefOutput and buildRefsByCommit", () => {
  const raw = [
    ["refs/heads/main", "aaa", "", "main"].join("\x1f"),
    ["refs/remotes/origin/main", "aaa", "", "origin/main"].join("\x1f"),
    ["refs/tags/v1.0", "ttt", "aaa", "v1.0"].join("\x1f"),
    ["refs/stash", "sss", "", "stash"].join("\x1f"),
  ]
    .map((line) => `${line}\n`)
    .join("");

  it("dereferences annotated tags onto their commit", () => {
    const rows = parseForEachRefOutput(raw);
    expect(rows).toHaveLength(4);
    const tagRow = rows.find((row) => row.refName === "refs/tags/v1.0");
    expect(tagRow?.commitHash).toBe("aaa");
  });

  it("groups refs per commit with HEAD first and a stable kind order", () => {
    const rows = parseForEachRefOutput(raw);
    const map = buildRefsByCommit(rows, "aaa");
    const refs = map.get("aaa") ?? [];
    expect(refs.map((ref) => ref.name)).toEqual([
      "main",
      "origin/main",
      "v1.0",
    ]);
    expect(refs[0]?.isHead).toBe(true);
    expect(refs[0]?.kind).toBe("branch");
  });

  it("adds a synthetic HEAD ref for detached heads", () => {
    const rows = parseForEachRefOutput(
      [["refs/heads/main", "bbb", "", "main"].join("\x1f"), "\n"].join(""),
    );
    const map = buildRefsByCommit(rows, "aaa");
    const refs = map.get("aaa") ?? [];
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "other", isHead: true });
  });

  it("sorts head-marked branch before the same-name remote", () => {
    const rows = parseForEachRefOutput(raw);
    const map = buildRefsByCommit(rows, "aaa");
    expect((map.get("aaa") ?? [])[0]?.name).toBe("main");
  });

  it("marks the symbolic HEAD branch when several branches share its commit", () => {
    const rows = parseForEachRefOutput(
      [
        ["refs/heads/feature", "aaa", "", "feature"].join("\x1f"),
        ["refs/heads/main", "aaa", "", "main"].join("\x1f"),
      ]
        .map((line) => `${line}\n`)
        .join(""),
    );
    const refs =
      buildRefsByCommit(rows, "aaa", "refs/heads/main").get("aaa") ?? [];
    expect(refs.find((ref) => ref.name === "main")?.isHead).toBe(true);
    expect(refs.find((ref) => ref.name === "feature")?.isHead).toBe(false);
  });
});

describe("listBranchRefs", () => {
  const rows = parseForEachRefOutput(
    [
      ["refs/heads/feature", "f1", "", "feature"].join("\x1f"),
      ["refs/heads/main", "h1", "", "main"].join("\x1f"),
      ["refs/remotes/origin/HEAD", "h1", "", "origin/HEAD"].join("\x1f"),
      ["refs/remotes/origin/main", "h1", "", "origin/main"].join("\x1f"),
      ["refs/remotes/origin/feature", "f1", "", "origin/feature"].join("\x1f"),
      ["refs/tags/v1", "t1", "", "v1"].join("\x1f"),
    ]
      .map((line) => `${line}\n`)
      .join(""),
  );

  it("lists local and remote branches, marking HEAD, current first", () => {
    const branches = listBranchRefs(rows, "h1");
    expect(branches.map((branch) => branch.fullName)).toEqual([
      "refs/heads/main",
      "refs/heads/feature",
      "refs/remotes/origin/feature",
      "refs/remotes/origin/main",
    ]);
    expect(branches[0]).toMatchObject({
      shortName: "main",
      isRemote: false,
      isHead: true,
    });
    expect(branches[3]).toMatchObject({
      shortName: "origin/main",
      isRemote: true,
      isHead: false,
    });
  });

  it("excludes remote HEAD aliases and non-branch refs", () => {
    const branches = listBranchRefs(rows, "h1");
    expect(branches.some((branch) => branch.fullName.endsWith("/HEAD"))).toBe(
      false,
    );
    expect(
      branches.some((branch) => branch.fullName.startsWith("refs/tags/")),
    ).toBe(false);
  });

  it("marks no branch current when HEAD is unknown", () => {
    const branches = listBranchRefs(rows, null);
    expect(branches.every((branch) => branch.isHead === false)).toBe(true);
  });

  it("uses the symbolic HEAD ref when branches point to the same commit", () => {
    const sameCommitRows = parseForEachRefOutput(
      [
        ["refs/heads/feature", "h1", "", "feature"].join("\x1f"),
        ["refs/heads/main", "h1", "", "main"].join("\x1f"),
      ]
        .map((line) => `${line}\n`)
        .join(""),
    );
    const branches = listBranchRefs(sameCommitRows, "h1", "refs/heads/main");
    expect(
      branches
        .filter((branch) => branch.isHead)
        .map((branch) => branch.shortName),
    ).toEqual(["main"]);
  });
});

describe("parseStatusPorcelain", () => {
  it("counts staged, unstaged, untracked, conflicted, and renames", () => {
    const raw = [
      "?? new.txt",
      "M  staged.txt",
      " M unstaged.txt",
      "MM both.txt",
      "UU conflict.txt",
      "R  renamed.txt",
      "original.txt",
      "A  added.txt",
    ].join("\0");
    const summary = parseStatusPorcelain(`${raw}\0`);
    expect(summary).toMatchObject({
      staged: 4,
      unstaged: 2,
      untracked: 1,
      conflicted: 1,
      total: 7,
      truncated: false,
    });
  });

  it("marks the summary truncated at the entry cap", () => {
    const entries = Array.from(
      { length: 5 },
      (_, index) => `?? file${index}.txt`,
    ).join("\0");
    const summary = parseStatusPorcelain(`${entries}\0`, 3);
    expect(summary.total).toBe(3);
    expect(summary.truncated).toBe(true);
  });

  it("returns zeros for a clean repository", () => {
    const summary = parseStatusPorcelain("");
    expect(summary).toMatchObject({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      total: 0,
      truncated: false,
    });
  });
});

describe("parseNameStatus", () => {
  it("parses plain and paired entries", () => {
    const raw = [
      "A",
      "src/new.ts",
      "M",
      "src/old.ts",
      "D",
      "gone.ts",
      "R100",
      "moved.ts",
      "from.ts",
    ].join("\0");
    const changes = parseNameStatus(`${raw}\0`);
    expect(changes).toEqual([
      { path: "src/new.ts", status: "added", oldPath: null },
      { path: "src/old.ts", status: "modified", oldPath: null },
      { path: "gone.ts", status: "deleted", oldPath: null },
      { path: "moved.ts", status: "renamed", oldPath: "from.ts" },
    ]);
  });

  it("maps unknown status letters to unknown", () => {
    const changes = parseNameStatus(["X", "odd.ts"].join("\0"));
    expect(changes[0]?.status).toBe("unmerged");
  });
});

describe("isUnbornHeadMessage", () => {
  it("recognizes unborn branch errors", () => {
    expect(
      isUnbornHeadMessage(
        "fatal: your current branch 'main' does not have any commits yet",
      ),
    ).toBe(true);
    expect(isUnbornHeadMessage("fatal: bad revision 'HEAD'")).toBe(true);
  });

  it("does not swallow unrelated failures", () => {
    expect(isUnbornHeadMessage("fatal: not a git repository")).toBe(false);
  });
});
