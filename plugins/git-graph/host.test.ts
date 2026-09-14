import { describe, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { createGitGraphHostEntry } from "./host.js";
import type { FsReader } from "./git/discovery.js";
import type { GitRunner } from "./git/run.js";

const RS = "\x1e";
const US = "\x1f";
const ROOT = "C:/repos/R";

const fsWithRootRepo: FsReader = {
  async readDir() {
    throw new Error("not needed");
  },
  async stat(target) {
    const normalized = target.split("\\").join("/");
    if (normalized === ROOT || normalized === `${ROOT}/.git`) {
      return { isDirectory: true, isFile: false };
    }
    return null;
  },
  async readFileUtf8() {
    return null;
  },
};

interface GitScript {
  match: (args: readonly string[]) => boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function command(args: readonly string[]): string[] {
  return args.slice(6);
}

function gitFromScript(script: readonly GitScript[]): {
  runner: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: GitRunner = async (args) => {
    calls.push([...args]);
    const entry = script.find((candidate) => candidate.match(args));
    if (entry === undefined) {
      return {
        stdout: "",
        stderr: `unexpected git call: ${args.join(" ")}`,
        exitCode: 129,
      };
    }
    return {
      stdout: entry.stdout ?? "",
      stderr: entry.stderr ?? "",
      exitCode: entry.exitCode ?? 0,
    };
  };
  return { runner, calls };
}

const HEAD_SCRIPT: readonly GitScript[] = [
  {
    match: (args) =>
      command(args)[0] === "rev-parse" && command(args)[1] === "HEAD",
    stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
  },
  {
    match: (args) =>
      command(args)[0] === "show" &&
      command(args).some((arg) => arg.includes("%h")),
    stdout: "aaaa123\n",
  },
  {
    match: (args) => command(args)[0] === "symbolic-ref",
    stdout: "main\n",
  },
];

const HISTORY_SCRIPT: readonly GitScript[] = [
  {
    match: (args) => command(args)[0] === "log",
    stdout:
      `${["c1f0", "c1a", "c0f0", "Alice", "a@e", "2026-09-01T10:00:00Z", "Merge feature"].join(US)}${RS}` +
      `${["c0f0", "c0a", "", "Alice", "a@e", "2026-08-31T09:00:00Z", "Initial"].join(US)}${RS}`,
  },
  {
    match: (args) =>
      command(args)[0] === "rev-parse" && command(args)[1] === "HEAD",
    stdout: "c1f0\n",
  },
  {
    match: (args) => command(args)[0] === "for-each-ref",
    stdout: [
      ["refs/heads/main", "c1f0", "", "main"].join("\x1f"),
      ["refs/remotes/origin/main", "c1f0", "", "origin/main"].join("\x1f"),
      ["refs/tags/v1", "tagobj", "c0f0", "v1"].join("\x1f"),
    ]
      .map((line) => `${line}\n`)
      .join(""),
  },
];

async function harnessWith(
  script: readonly GitScript[],
  fs: FsReader = fsWithRootRepo,
) {
  const { runner, calls } = gitFromScript(script);
  const harness = experimental_createHostEntryHarness(
    createGitGraphHostEntry({ runGit: runner, fs }),
  );
  return { harness, calls };
}

describe("git-graph host entry", () => {
  it("scans repositories through the service on the host machine", async () => {
    const { harness } = await harnessWith(HEAD_SCRIPT);
    const result = await harness.experimental_call("scanRepos", {
      sourceRoot: ROOT,
    });
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      relPath: "",
      position: "root",
      gitLink: "direct",
      head: { abbrev: "aaaa123", branch: "main", detached: false },
    });
  });

  it("returns history with refs and the HEAD marker", async () => {
    const { harness } = await harnessWith(HISTORY_SCRIPT);
    const result = await harness.experimental_call("history", {
      sourceRoot: ROOT,
      repoRelPath: "",
      offset: 0,
      limit: 50,
      includeRemotes: true,
      refs: [],
    });
    expect(result.commits).toHaveLength(2);
    expect(
      result.commits[0]?.refs.map(
        (ref) => `${ref.isHead ? "!" : ""}${ref.name}`,
      ),
    ).toEqual(["!main", "origin/main"]);
    expect(result.commits[1]?.refs.map((ref) => ref.name)).toEqual(["v1"]);
  });

  it("returns an empty page for a repository without commits", async () => {
    const { harness } = await harnessWith([
      {
        match: (args) =>
          command(args)[0] === "rev-parse" && command(args)[1] === "HEAD",
        exitCode: 128,
        stderr:
          "fatal: your current branch 'main' does not have any commits yet\n",
      },
      {
        match: (args) => command(args)[0] === "log",
        exitCode: 128,
        stderr:
          "fatal: your current branch 'main' does not have any commits yet\n",
      },
      {
        match: (args) => command(args).includes("--verify"),
        exitCode: 1,
        stderr: "",
      },
    ]);
    const result = await harness.experimental_call("history", {
      sourceRoot: ROOT,
      repoRelPath: "",
      offset: 0,
      limit: 50,
      includeRemotes: false,
      refs: [],
    });
    expect(result).toEqual({ commits: [], empty: true });
  });

  it("returns commit details with files and the merge note", async () => {
    const { harness } = await harnessWith([
      {
        match: (args) =>
          command(args)[0] === "show" &&
          command(args).some((arg) => arg.includes("%T")),
        stdout: [
          [
            "c1f",
            "c1a",
            "tree1",
            "p1f p2f",
            "Alice",
            "a@e",
            "2026-09-01T10:00:00Z",
            "Committer",
            "c@e",
            "2026-09-01T11:00:00Z",
            "Merge feature\n\nBody",
          ].join(US),
          RS,
        ].join(""),
      },
      {
        match: (args) =>
          command(args)[0] === "show" &&
          command(args).some((a) => a.includes("%s")),
        stdout:
          `${["p1f0", "p1a", "First parent"].join(US)}${RS}` +
          `${["p2f0", "p2a", "Second parent"].join(US)}${RS}`,
      },
      {
        match: (args) =>
          command(args)[0] === "rev-parse" && command(args)[1] === "HEAD",
        stdout: "c1f\n",
      },
      {
        match: (args) => command(args)[0] === "for-each-ref",
        stdout: `${["refs/heads/main", "c1f0", "", "main"].join("\x1f")}\n`,
      },
      {
        match: (args) => command(args)[0] === "diff-tree",
        stdout: ["M", "src/old.ts", "A", "src/new.ts"].join("\0"),
      },
    ]);
    const result = await harness.experimental_call("commitDetail", {
      sourceRoot: ROOT,
      repoRelPath: "",
      hash: "c1f0",
    });
    expect(result.commit.isMerge).toBe(true);
    expect(result.commit.parents).toHaveLength(2);
    expect(result.commit.parents[0]).toMatchObject({
      hash: "p1f0",
      subject: "First parent",
    });
    expect(result.files).toEqual([
      { path: "src/old.ts", status: "modified", oldPath: null },
      { path: "src/new.ts", status: "added", oldPath: null },
    ]);
    expect(result.filesNote).toBe("Compared against the first parent.");
  });

  it("disables external diff drivers and textconv filters on patches", async () => {
    const { harness, calls } = await harnessWith([
      {
        match: (args) =>
          command(args)[0] === "show" &&
          command(args).some((arg) => arg.includes("%P")),
        stdout: "p1f\n",
      },
      {
        match: (args) => command(args)[0] === "diff-tree",
        stdout: "--- a/src/old.ts\n+++ b/src/old.ts\n",
      },
    ]);
    const result = await harness.experimental_call("filePatch", {
      sourceRoot: ROOT,
      repoRelPath: "",
      hash: "c1f0",
      path: "src/old.ts",
    });
    expect(result.patch).toContain("+++ b/src/old.ts");
    const patchCall = calls.find(
      (args) => args.includes("diff-tree") && args.includes("-p"),
    );
    expect(patchCall).toBeDefined();
    expect(patchCall).toContain("--no-ext-diff");
    expect(patchCall).toContain("--no-textconv");
    expect(patchCall?.slice(patchCall.indexOf("--") + 1)).toEqual([
      "src/old.ts",
    ]);
  });

  it("disables fsmonitor on every git invocation", async () => {
    const { harness, calls } = await harnessWith(HISTORY_SCRIPT);
    await harness.experimental_call("history", {
      sourceRoot: ROOT,
      repoRelPath: "",
      offset: 0,
      limit: 10,
      includeRemotes: false,
      refs: [],
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const fsmonitorIndex = call.indexOf("core.fsmonitor=false");
      expect(fsmonitorIndex).toBeGreaterThan(0);
      expect(call[fsmonitorIndex - 1]).toBe("-c");
    }
  });

  it("reports dirty counts and selectable branches without remote HEAD", async () => {
    const { harness } = await harnessWith([
      {
        match: (args) => command(args)[0] === "status",
        stdout: ["?? new.txt", "M  staged.txt", " M unstaged.txt"].join("\0"),
      },
      {
        match: (args) => command(args)[0] === "for-each-ref",
        stdout: [
          ["refs/heads/feature", "f1", "", "feature"].join("\x1f"),
          ["refs/heads/main", "h1", "", "main"].join("\x1f"),
          ["refs/remotes/origin/HEAD", "h1", "", "origin/HEAD"].join("\x1f"),
          ["refs/remotes/origin/main", "h1", "", "origin/main"].join("\x1f"),
        ]
          .map((line) => `${line}\n`)
          .join(""),
      },
      {
        match: (args) =>
          command(args)[0] === "rev-parse" && command(args)[1] === "HEAD",
        stdout: "h1\n",
      },
    ]);
    const result = await harness.experimental_call("repoStatus", {
      sourceRoot: ROOT,
      repoRelPath: "",
    });
    expect(result.dirty).toMatchObject({
      staged: 1,
      unstaged: 1,
      untracked: 1,
      total: 3,
      truncated: false,
    });
    expect(result.branches.map((branch) => branch.fullName)).toEqual([
      "refs/heads/main",
      "refs/heads/feature",
      "refs/remotes/origin/main",
    ]);
    expect(result.branches[0]).toMatchObject({ isHead: true });
    expect(result.remoteRefCount).toBe(1);
  });

  it("scopes git log argv to the selected refs, or all branches with the remote toggle", async () => {
    const { harness, calls } = await harnessWith(HISTORY_SCRIPT);
    await harness.experimental_call("history", {
      sourceRoot: ROOT,
      repoRelPath: "",
      offset: 0,
      limit: 10,
      includeRemotes: false,
      refs: ["refs/heads/feature", "refs/remotes/origin/main"],
    });
    await harness.experimental_call("history", {
      sourceRoot: ROOT,
      repoRelPath: "",
      offset: 0,
      limit: 10,
      includeRemotes: true,
      refs: [],
    });
    const logCalls = calls.filter((call) => call.includes("log"));
    expect(logCalls).toHaveLength(2);
    expect(logCalls[0]?.slice(7, 9)).toEqual([
      "refs/heads/feature",
      "refs/remotes/origin/main",
    ]);
    expect(logCalls[0]?.includes("--branches")).toBe(false);
    expect(logCalls[0]?.includes("HEAD")).toBe(false);
    expect(logCalls[1]?.slice(7, 10)).toEqual([
      "HEAD",
      "--branches",
      "--remotes",
    ]);
  });

  it("rejects option-shaped refs before invoking git", async () => {
    const { harness, calls } = await harnessWith(HISTORY_SCRIPT);
    await expect(
      harness.experimental_call("history", {
        sourceRoot: ROOT,
        repoRelPath: "",
        offset: 0,
        limit: 10,
        includeRemotes: false,
        refs: ["refs/heads/main", "--output=/tmp/x"],
      }),
    ).rejects.toThrow();
    expect(calls.some((call) => call.includes("log"))).toBe(false);
  });

  it("rejects repository paths that are not under the scanned source root", async () => {
    const { harness } = await harnessWith(HEAD_SCRIPT);
    await expect(
      harness.experimental_call("history", {
        sourceRoot: ROOT,
        repoRelPath: "missing",
        offset: 0,
        limit: 10,
        includeRemotes: false,
        refs: [],
      }),
    ).rejects.toThrow(/was not found under/u);
  });

  it("rejects climbing paths that do not match the enclosing repository", async () => {
    const { harness } = await harnessWith([
      {
        match: (args) =>
          command(args)[0] === "rev-parse" &&
          command(args)[1] === "--show-toplevel",
        stdout: "C:/elsewhere\n",
      },
    ]);
    await expect(
      harness.experimental_call("history", {
        sourceRoot: ROOT,
        repoRelPath: "../climb",
        offset: 0,
        limit: 10,
        includeRemotes: false,
        refs: [],
      }),
    ).rejects.toThrow(/does not match the enclosing repository/u);
  });

  it("accepts the enclosing repository when it matches the git toplevel", async () => {
    const { harness } = await harnessWith([
      {
        match: (args) =>
          command(args)[0] === "rev-parse" &&
          command(args)[1] === "--show-toplevel",
        stdout: "C:/proj\n",
      },
      ...HISTORY_SCRIPT,
    ]);
    const result = await harness.experimental_call("history", {
      sourceRoot: "C:/proj/sub",
      repoRelPath: "..",
      offset: 0,
      limit: 50,
      includeRemotes: false,
      refs: [],
    });
    expect(result.commits).toHaveLength(2);
    expect(result.commits[0]?.subject).toBe("Merge feature");
  });

  it("rejects unsafe file paths before invoking git", async () => {
    const { harness, calls } = await harnessWith(HEAD_SCRIPT);
    for (const path of [
      "../outside.txt",
      "-C",
      "C:\\windows\\x",
      "/etc/passwd",
    ]) {
      await expect(
        harness.experimental_call("filePatch", {
          sourceRoot: ROOT,
          repoRelPath: "",
          hash: "c1f0",
          path,
        }),
      ).rejects.toThrow(/Invalid repository file path/u);
    }
    expect(
      calls.some((args) => args.includes("diff-tree") && args.includes("-p")),
    ).toBe(false);
  });

  it("rejects malformed repository paths without invoking git", async () => {
    const { harness, calls } = await harnessWith(HEAD_SCRIPT);
    await expect(
      harness.experimental_call("history", {
        sourceRoot: ROOT,
        repoRelPath: "a/../../climb",
        offset: 0,
        limit: 10,
        includeRemotes: false,
        refs: [],
      }),
    ).rejects.toThrow(/Invalid repository path/u);
    expect(calls).toHaveLength(0);
  });
});
