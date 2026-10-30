import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { runGit } from "bb-environment-provider-host/workspace-git";
import type { GitReadFreshness } from "../contract.js";
import { WorkspaceReads } from "./workspace-reads.js";

const STATUS_BUDGET = {
  maxFiles: 200,
  maxUntrackedLineStatFiles: 50,
  maxUntrackedLineStatBytes: 8 * 1024 * 1024,
};
const ALL_CHANGES = { type: "all", mergeBaseBranch: "main" } as const;

let logPath = "";

async function installGitShim(): Promise<void> {
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const shimDir = await makeTempDir("bb-git-shim-");
  logPath = path.join(shimDir, "calls.log");
  await fs.writeFile(
    path.join(shimDir, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nexec "${realGit}" "$@"\n`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`);
}

async function takeCalls(): Promise<string[]> {
  const calls = await fs.readFile(logPath, "utf8").catch(() => "");
  await fs.writeFile(logPath, "");
  return calls
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) =>
      line
        .replace(/^--no-optional-locks /u, "")
        .split(" ")
        .slice(0, 2)
        .join(" "),
    )
    .sort();
}

async function initPullRequestRepo(): Promise<string> {
  const repo = await initRepo(await makeTempDir("bb-git-budget-"));
  await fs.writeFile(path.join(repo, "app.ts"), "export const a = 1;\n");
  await runGit(["add", "app.ts"], { cwd: repo });
  await runGit(["commit", "-q", "-m", "base"], { cwd: repo });
  await runGit(["checkout", "-q", "-b", "feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, "app.ts"), "export const a = 2;\n");
  await runGit(["commit", "-q", "-am", "feature work"], { cwd: repo });
  return repo;
}

async function readLikeTheDiffTab(
  reads: WorkspaceReads,
  freshness: GitReadFreshness,
  changedPaths: string[],
): Promise<void> {
  await Promise.all([
    reads.getStatus({ freshness, ...STATUS_BUDGET }),
    reads.diffFiles({
      freshness,
      target: ALL_CHANGES,
      maxFiles: 500,
      ignoreWhitespace: false,
    }),
  ]);
  await reads.diffPatch({
    freshness,
    target: ALL_CHANGES,
    paths: changedPaths,
    maxBytesPerFile: 512 * 1024,
    ignoreWhitespace: false,
  });
}

describe("git processes per workspace change", () => {
  beforeEach(async () => {
    await installGitShim();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.skipIf(process.platform === "win32")("keeps an edit with Diff open to its status, one diff, untracked stats and the patches", async () => {
    const repo = await initPullRequestRepo();
    const reads = new WorkspaceReads(repo, tmpdir());
    await readLikeTheDiffTab(reads, { work: "w1", refs: "r1" }, ["app.ts"]);
    await takeCalls();

    await fs.appendFile(path.join(repo, "README.md"), "edit 1\n");
    await fs.writeFile(path.join(repo, "new-1.txt"), "new 1\n");
    await readLikeTheDiffTab(reads, { work: "w2", refs: "r1" }, [
      "README.md",
      "new-1.txt",
    ]);
    expect(await takeCalls()).toEqual(
      [
        "status --porcelain=v2",
        "diff --numstat",
        "add --sparse",
        "diff --no-ext-diff",
        "diff --no-ext-diff",
        "hash-object --stdin-paths",
        "diff --no-ext-diff",
        "diff --no-ext-diff",
      ].sort(),
    );

    await fs.appendFile(path.join(repo, "README.md"), "edit 2\n");
    await readLikeTheDiffTab(reads, { work: "w3", refs: "r1" }, ["README.md"]);
    expect(await takeCalls()).toEqual(
      [
        "status --porcelain=v2",
        "diff --numstat",
        "diff --no-ext-diff",
        "hash-object --stdin-paths",
        "diff --no-ext-diff",
      ].sort(),
    );
    await reads.dispose();
  });

  it.skipIf(process.platform === "win32")("reads only status and its numstat for a tracked edit with Diff closed", async () => {
    const repo = await initPullRequestRepo();
    const reads = new WorkspaceReads(repo, tmpdir());
    await reads.getStatus({
      freshness: { work: "w1", refs: "r1" },
      mergeBaseBranch: "main",
      ...STATUS_BUDGET,
    });
    await takeCalls();

    await fs.appendFile(path.join(repo, "README.md"), "edit\n");
    await reads.getStatus({
      freshness: { work: "w2", refs: "r1" },
      mergeBaseBranch: "main",
      ...STATUS_BUDGET,
    });
    expect(await takeCalls()).toEqual(
      ["diff --numstat", "status --porcelain=v2"].sort(),
    );
    await reads.dispose();
  });

  it("leaves the repository index untouched while reading", async () => {
    const repo = await initPullRequestRepo();
    await fs.writeFile(path.join(repo, "new.txt"), "new\n");
    const indexPath = path.join(repo, ".git", "index");
    const later = new Date(Date.now() + 5_000);
    await fs.utimes(path.join(repo, "README.md"), later, later);
    await fs.utimes(path.join(repo, "app.ts"), later, later);
    const before = createHash("sha1")
      .update(await fs.readFile(indexPath))
      .digest("hex");

    const reads = new WorkspaceReads(repo, tmpdir());
    await readLikeTheDiffTab(reads, { work: "w1", refs: "r1" }, [
      "README.md",
      "app.ts",
      "new.txt",
    ]);
    await reads.dispose();

    expect(
      createHash("sha1")
        .update(await fs.readFile(indexPath))
        .digest("hex"),
    ).toBe(before);
  });
});
