import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHostDirectories } from "./host-directories.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "bb",
      GIT_AUTHOR_EMAIL: "bb@example.com",
      GIT_COMMITTER_NAME: "bb",
      GIT_COMMITTER_EMAIL: "bb@example.com",
    },
    stdio: "ignore",
  });
}

describe("resolveHostDirectories", () => {
  let root: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "bb-resolve-dirs-")));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves symlinks and matches a linked worktree to its repository", async () => {
    const repo = join(root, "repo");
    await mkdir(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    await writeFile(join(repo, "README.md"), "fixture\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    const worktree = join(root, "repo-feature");
    git(repo, ["worktree", "add", "-q", "-b", "feature", worktree]);
    const outside = join(root, "outside");
    await mkdir(outside);
    const link = join(repo, "link");
    await symlink(outside, link, "junction");
    const file = join(repo, "README.md");

    const { entries } = await resolveHostDirectories({
      type: "host.resolve_directories",
      paths: [repo, worktree, link, file, join(root, "missing"), "relative"],
    });

    const repoCommonDir = await realpath(join(repo, ".git"));
    expect(entries).toEqual([
      { path: repo, realPath: repo, gitCommonDir: repoCommonDir },
      { path: worktree, realPath: worktree, gitCommonDir: repoCommonDir },
      { path: link, realPath: outside, gitCommonDir: null },
      { path: file, realPath: null, gitCommonDir: null },
      { path: join(root, "missing"), realPath: null, gitCommonDir: null },
      { path: "relative", realPath: null, gitCommonDir: null },
    ]);
  });
});
