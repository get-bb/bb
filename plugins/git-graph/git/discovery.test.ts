import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_LIMITS,
  parseGitLinkFile,
  scanDirectoryTree,
  type FsDirEntry,
  type FsReader,
} from "./discovery.js";

interface DirSpec {
  dirs?: string[];
  files?: string[];
  dotGitFile?: string;
  symlinks?: string[];
}

function makeFs(spec: Record<string, DirSpec>): FsReader {
  const lookup = (dir: string) => spec[dir.replace(/\/+$/u, "")];
  return {
    async readDir(dir) {
      const node = lookup(dir);
      if (node === undefined) throw new Error(`ENOENT ${dir}`);
      const entries: FsDirEntry[] = [];
      for (const name of node.dirs ?? []) {
        entries.push({
          name,
          isDirectory: true,
          isFile: false,
          isSymbolicLink: false,
        });
      }
      for (const name of node.files ?? []) {
        entries.push({
          name,
          isDirectory: false,
          isFile: true,
          isSymbolicLink: false,
        });
      }
      for (const name of node.symlinks ?? []) {
        entries.push({
          name,
          isDirectory: true,
          isFile: false,
          isSymbolicLink: true,
        });
      }
      if (node.dotGitFile !== undefined) {
        entries.push({
          name: ".git",
          isDirectory: false,
          isFile: true,
          isSymbolicLink: false,
        });
      }
      return entries;
    },
    async stat(target) {
      if (lookup(target) !== undefined) {
        return { isDirectory: true, isFile: false };
      }
      const parentPath = target.slice(0, target.lastIndexOf("/"));
      const name = target.slice(target.lastIndexOf("/") + 1);
      const parent = lookup(parentPath);
      if (parent === undefined) return null;
      if (
        (parent.dirs ?? []).includes(name) ||
        (parent.symlinks ?? []).includes(name)
      ) {
        return { isDirectory: true, isFile: false };
      }
      if (name === ".git" && parent.dotGitFile !== undefined) {
        return { isDirectory: false, isFile: true };
      }
      if ((parent.files ?? []).includes(name)) {
        return { isDirectory: false, isFile: true };
      }
      return null;
    },
    async readFileUtf8(target) {
      if (!target.endsWith("/.git")) return null;
      const parent = lookup(target.slice(0, -"/.git".length));
      return parent?.dotGitFile ?? null;
    },
  };
}

describe("parseGitLinkFile", () => {
  it("classifies a submodule gitdir", () => {
    const parsed = parseGitLinkFile(
      "gitdir: C:/Source/proj/.git/modules/vendor/dep\n",
      "R/vendor/dep",
    );
    expect(parsed).toEqual({
      gitLink: "submodule",
      gitDir: "C:/Source/proj/.git/modules/vendor/dep",
    });
  });

  it("classifies a worktree gitdir with a relative path", () => {
    const parsed = parseGitLinkFile("gitdir: ../.git/worktrees/fix\n", "R/fix");
    expect(parsed).toEqual({
      gitLink: "worktree",
      gitDir: "R/.git/worktrees/fix",
    });
  });

  it("normalizes windows separators in a relative gitdir", () => {
    const parsed = parseGitLinkFile(
      "gitdir: ..\\.git\\worktrees\\fix",
      "R/fix",
    );
    expect(parsed?.gitDir).toBe("R/.git/worktrees/fix");
    expect(parsed?.gitLink).toBe("worktree");
  });

  it("rejects content that is not a gitdir pointer", () => {
    expect(parseGitLinkFile("garbage", "R/x")).toBeNull();
  });
});

describe("scanDirectoryTree", () => {
  it("finds the root repo, a nested repo, a worktree, and a submodule", async () => {
    const fs = makeFs({
      R: { dirs: [".git", "src", "tools", "vendor"] },
      "R/src": { dirs: [] },
      "R/tools": { dirs: ["cli"] },
      "R/tools/cli": { dotGitFile: "gitdir: C:/x/.git/worktrees/cli\n" },
      "R/vendor": { dirs: ["dep"] },
      "R/vendor/dep": { dotGitFile: "gitdir: C:/x/.git/modules/dep\n" },
    });
    const result = await scanDirectoryTree("R", fs);
    expect(result.rootIsRepo).toBe(true);
    expect(result.repos.map((repo) => repo.relPath)).toEqual([
      "",
      "tools/cli",
      "vendor/dep",
    ]);
    expect(result.repos.map((repo) => repo.position)).toEqual([
      "root",
      "nested",
      "nested",
    ]);
    expect(result.repos.map((repo) => repo.gitLink)).toEqual([
      "direct",
      "worktree",
      "submodule",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("skips service and heavy directories and never enters .git", async () => {
    const fs = makeFs({
      R: {
        dotGitFile: "gitdir: C:/x/.git/worktrees/cli\n",
        dirs: ["node_modules", ".runtime", "dist"],
      },
      "R/node_modules/pkg": { dirs: [".git"] },
      "R/.runtime/cache": { dirs: [".git"] },
      "R/dist/deep/repo": { dirs: [".git"] },
    });
    const result = await scanDirectoryTree("R", fs);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      relPath: "",
      gitLink: "worktree",
    });
  });

  it("does not follow symlinked directories", async () => {
    const fs = makeFs({
      R: { dirs: [], symlinks: ["elsewhere"] },
      elsewhere: { dirs: [".git"] },
    });
    const result = await scanDirectoryTree("R", fs);
    expect(result.repos).toHaveLength(0);
  });

  it("reports the root when the project folder itself is not a repository", async () => {
    const fs = makeFs({
      R: { dirs: ["docs"] },
      "R/docs": { dirs: [".git"] },
    });
    const result = await scanDirectoryTree("R", fs);
    expect(result.rootIsRepo).toBe(false);
    expect(result.repos.map((repo) => repo.relPath)).toEqual(["docs"]);
  });

  it("stops at the depth limit without flagging truncation", async () => {
    const fs = makeFs({
      R: { dirs: ["a"] },
      "R/a": { dirs: ["b"] },
      "R/a/b": { dirs: ["c"] },
      "R/a/b/c": { dirs: ["d"] },
      "R/a/b/c/d": { dirs: ["e"] },
      "R/a/b/c/d/e": { dirs: [".git"] },
    });
    const result = await scanDirectoryTree("R", fs, {
      ...DEFAULT_SCAN_LIMITS,
      maxDepth: 4,
    });
    expect(result.repos).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("flags truncation when the directory budget is exhausted", async () => {
    const spec: Record<string, DirSpec> = {};
    const childNames: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      spec[`R/d${index}`] = { dirs: ["repo"] };
      spec[`R/d${index}/repo`] = { dirs: [".git"] };
      childNames.push(`d${index}`);
    }
    spec.R = { dirs: childNames };
    const fs = makeFs(spec);
    const result = await scanDirectoryTree("R", fs, {
      ...DEFAULT_SCAN_LIMITS,
      maxDirectories: 5,
    });
    expect(result.truncated).toBe(true);
    expect(result.repos.length).toBeGreaterThan(0);
    expect(result.repos.length).toBeLessThan(40);
  });

  it("returns an empty result when the source root is missing", async () => {
    const fs = makeFs({});
    const result = await scanDirectoryTree("R", fs);
    expect(result.repos).toEqual([]);
    expect(result.rootIsRepo).toBe(false);
  });
});
