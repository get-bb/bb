import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGitRepos } from "./find-git-repos.js";

let root: string;

function initRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-q", repoPath]);
}

function find(folderPaths: string[], maxDepth = 2, maxRepos = 64) {
  return findGitRepos({
    type: "host.find_git_repos",
    folderPaths,
    maxDepth,
    maxRepos,
  });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "bb-find-git-repos-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findGitRepos", () => {
  it("finds repos inside a plain folder, stops at each repo and skips hidden and dependency folders", async () => {
    initRepo(path.join(root, "api"));
    initRepo(path.join(root, "api", "packages", "nested"));
    initRepo(path.join(root, "group", "web"));
    initRepo(path.join(root, "deep", "a", "b"));
    initRepo(path.join(root, "node_modules", "dep"));
    initRepo(path.join(root, ".cache", "hidden"));
    symlinkSync(path.join(root, "api"), path.join(root, "api-link"));

    const { folders } = await find([root]);

    expect(folders).toEqual([
      {
        path: root,
        exists: true,
        gitRoot: null,
        repos: [path.join(root, "api"), path.join(root, "group", "web")],
        truncated: false,
      },
    ]);
  });

  it("reports the repo top level for a folder inside a repo and does not look inside it", async () => {
    initRepo(path.join(root, "mono"));
    initRepo(path.join(root, "mono", "packages", "app", "vendored"));
    const subfolder = path.join(root, "mono", "packages", "app");

    const { folders } = await find([subfolder, path.join(root, "missing")]);

    expect(folders).toEqual([
      {
        path: subfolder,
        exists: true,
        gitRoot: path.join(root, "mono"),
        repos: [],
        truncated: false,
      },
      {
        path: path.join(root, "missing"),
        exists: false,
        gitRoot: null,
        repos: [],
        truncated: false,
      },
    ]);
  });

  it("counts linked worktrees as repos and stops at maxRepos", async () => {
    const main = path.join(root, "main");
    initRepo(main);
    execFileSync("git", [
      "-C",
      main,
      "-c",
      "user.email=a@b",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    const workspace = path.join(root, "workspace");
    mkdirSync(workspace);
    execFileSync("git", [
      "-C",
      main,
      "worktree",
      "add",
      "-q",
      path.join(workspace, "one"),
    ]);
    execFileSync("git", [
      "-C",
      main,
      "worktree",
      "add",
      "-q",
      path.join(workspace, "two"),
    ]);

    expect((await find([workspace])).folders[0]).toMatchObject({
      repos: [path.join(workspace, "one"), path.join(workspace, "two")],
      truncated: false,
    });
    expect((await find([workspace], 2, 1)).folders[0]).toMatchObject({
      repos: [path.join(workspace, "one")],
      truncated: true,
    });
  });
});
