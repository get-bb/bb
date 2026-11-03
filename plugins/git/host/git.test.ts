import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGit } from "bb-environment-provider-host/workspace-git";
import {
  parseNameStatusEntries,
  parseNumstatEntriesZ,
  runGitWithNullRecordLimit,
  summarizeNumstat,
} from "./git.js";

const tempDirs: string[] = [];

async function initReadGitBlobRepo() {
  const repoPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-read-git-blob-"),
  );
  tempDirs.push(repoPath);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.mkdir(path.join(repoPath, "docs"));
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await fs.writeFile(path.join(repoPath, "docs", "index.md"), "docs\n", "utf8");
  await fs.writeFile(path.join(repoPath, "large.txt"), "0123456789\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

async function initEmptyRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-empty-git-"));
  tempDirs.push(repoPath);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  return repoPath;
}

async function initConflictRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-conflict-"));
  tempDirs.push(repoPath);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "base\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  await runGit(["switch", "-c", "feature"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "feature\n", "utf8");
  await runGit(["commit", "-am", "Feature edit"], { cwd: repoPath });
  await runGit(["switch", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "main\n", "utf8");
  await runGit(["commit", "-am", "Main edit"], { cwd: repoPath });
  return repoPath;
}

async function initDefaultBranchRemoteRepo() {
  const repoPath = await initReadGitBlobRepo();
  const remotePath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-remote-"));
  tempDirs.push(remotePath);
  await runGit(["init", "--bare"], { cwd: remotePath });
  await runGit(["remote", "add", "origin", remotePath], { cwd: repoPath });
  await runGit(["push", "-u", "origin", "main"], { cwd: repoPath });
  await runGit(["fetch", "origin"], { cwd: repoPath });
  return { remotePath, repoPath };
}

async function pushRemoteMainCommit(remotePath: string) {
  const cloneParent = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-git-remote-clone-"),
  );
  tempDirs.push(cloneParent);
  const clonePath = path.join(cloneParent, "repo");
  await runGit(["clone", "--branch", "main", remotePath, clonePath], {
    cwd: cloneParent,
  });
  await runGit(["config", "user.name", "BB Tests"], { cwd: clonePath });
  await runGit(["config", "user.email", "bb@example.com"], {
    cwd: clonePath,
  });
  await fs.writeFile(path.join(clonePath, "remote.txt"), "remote\n", "utf8");
  await runGit(["add", "."], { cwd: clonePath });
  await runGit(["commit", "-m", "Remote edit"], { cwd: clonePath });
  await runGit(["push", "origin", "main"], { cwd: clonePath });
}

async function initSshRemoteRepo() {
  const repoPath = await initReadGitBlobRepo();
  const sshLogPath = path.join(repoPath, "ssh-invocations.log");
  const sshScriptPath = path.join(repoPath, "recording-ssh.sh");
  await fs.writeFile(
    sshScriptPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(sshLogPath.replaceAll("\\", "/"))}\nprintf 'GIT_TERMINAL_PROMPT=%s\\n' "\${GIT_TERMINAL_PROMPT-unset}" >> ${JSON.stringify(sshLogPath.replaceAll("\\", "/"))}\nexit 255\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  await runGit(["remote", "add", "origin", "ssh://git.invalid/repo.git"], {
    cwd: repoPath,
  });
  await runGit(
    [
      "config",
      "core.sshCommand",
      "'" + sshScriptPath.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'",
    ],
    { cwd: repoPath },
  );
  return { repoPath, sshLogPath };
}

async function initBareWorktreeLayout() {
  const origin = await initReadGitBlobRepo();
  await runGit(["branch", "feature-a"], { cwd: origin });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-bare-layout-"));
  tempDirs.push(root);
  await runGit(["clone", "--bare", origin, ".bare"], { cwd: root });
  await fs.writeFile(path.join(root, ".git"), "gitdir: ./.bare\n", "utf8");
  await runGit(["worktree", "add", "feature-a", "feature-a"], { cwd: root });
  return { root, worktreePath: path.join(root, "feature-a") };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  );
});

describe("runGitWithNullRecordLimit", () => {
  it("stops an untracked path listing at the requested complete-record count", async () => {
    const repoPath = await initEmptyRepo();
    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        fs.writeFile(path.join(repoPath, `file-${index}.txt`), `${index}\n`),
      ),
    );

    const result = await runGitWithNullRecordLimit(
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { cwd: repoPath },
      "single",
      3,
    );

    expect(result.recordLimitReached).toBe(true);
    expect(result.recordCount).toBe(3);
    expect(result.stdout.split("\0").filter(Boolean)).toHaveLength(3);
  });

  it("counts only raw records of a combined raw and numstat diff", async () => {
    const repoPath = await initReadGitBlobRepo();
    await runGit(["mv", "README.md", "RENAMED.md"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "docs", "index.md"), "changed\n");
    const args = [
      "diff",
      "--raw",
      "--numstat",
      "--no-abbrev",
      "-M",
      "-z",
      "HEAD",
    ];

    const complete = await runGitWithNullRecordLimit(
      args,
      { cwd: repoPath },
      "raw-numstat",
      3,
    );
    expect(complete.recordLimitReached).toBe(false);
    expect(complete.stdout).toBe(
      (await runGit(args, { cwd: repoPath })).stdout,
    );

    const limited = await runGitWithNullRecordLimit(
      args,
      { cwd: repoPath },
      "raw-numstat",
      1,
    );
    expect(limited.recordLimitReached).toBe(true);
    expect(limited.recordCount).toBe(1);
  });

  it("keeps rename records complete when stopping name-status output", async () => {
    const repoPath = await initReadGitBlobRepo();
    await runGit(["mv", "README.md", "RENAMED.md"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "docs", "index.md"), "changed\n");
    await fs.rm(path.join(repoPath, "large.txt"));

    const result = await runGitWithNullRecordLimit(
      ["diff", "--name-status", "-M", "-z", "HEAD"],
      { cwd: repoPath },
      "name-status",
      2,
    );

    expect(result.recordLimitReached).toBe(true);
    expect(result.recordCount).toBe(2);
    expect(parseNameStatusEntries(result.stdout)).toHaveLength(2);
  });

  it("keeps rename records complete when stopping numstat output", async () => {
    const repoPath = await initReadGitBlobRepo();
    await runGit(["mv", "README.md", "RENAMED.md"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "RENAMED.md"), "hello\nmore\n");
    await fs.writeFile(path.join(repoPath, "docs", "index.md"), "changed\n");
    await fs.rm(path.join(repoPath, "large.txt"));

    const result = await runGitWithNullRecordLimit(
      ["diff", "--numstat", "-M", "-z", "HEAD"],
      { cwd: repoPath },
      "numstat",
      2,
    );

    expect(result.recordLimitReached).toBe(true);
    expect(result.recordCount).toBe(2);
    expect(parseNumstatEntriesZ(result.stdout)).toHaveLength(2);
    expect(parseNumstatEntriesZ(result.stdout)).toContainEqual({
      path: "RENAMED.md",
      insertions: 1,
      deletions: 0,
    });
  });

  it.skipIf(process.platform === "win32")(
    "does not confuse a regular numstat path ending in a tab with a rename",
    async () => {
      const repoPath = await initReadGitBlobRepo();
      const unusualPath = "trailing-tab\t";
      await fs.writeFile(path.join(repoPath, unusualPath), "one\n");
      await runGit(["add", unusualPath], { cwd: repoPath });

      const result = await runGitWithNullRecordLimit(
        ["diff", "--cached", "--numstat", "-z", "HEAD"],
        { cwd: repoPath },
        "numstat",
        1,
      );

      expect(result.recordLimitReached).toBe(true);
      expect(result.recordCount).toBe(1);
      expect(parseNumstatEntriesZ(result.stdout)).toEqual([
        { path: unusualPath, insertions: 1, deletions: 0 },
      ]);
    },
  );
});

describe("parseNameStatusEntries", () => {
  it("parses add, modify, and delete entries", () => {
    const output = [
      "A",
      "src/new.ts",
      "M",
      "src/existing.ts",
      "D",
      "src/old.ts",
      "",
    ].join("\0");
    expect(parseNameStatusEntries(output)).toEqual([
      { path: "src/new.ts", status: "A" },
      { path: "src/existing.ts", status: "M" },
      { path: "src/old.ts", status: "D" },
    ]);
  });

  it("takes the new path for rename and copy entries", () => {
    const output = [
      "R100",
      "src/old.ts",
      "src/new.ts",
      "C75",
      "src/base.ts",
      "src/copy.ts",
      "",
    ].join("\0");
    expect(parseNameStatusEntries(output)).toEqual([
      { path: "src/new.ts", status: "R" },
      { path: "src/copy.ts", status: "C" },
    ]);
  });

  it("skips truncated trailing entries without throwing", () => {
    expect(parseNameStatusEntries("M\0")).toEqual([]);
    expect(parseNameStatusEntries("R100\0src/old.ts\0")).toEqual([]);
  });
});

describe("summarizeNumstat", () => {
  it("totals changed files, insertions, and deletions", () => {
    expect(
      summarizeNumstat(
        ["10\t4\tREADME.md", "-\t-\tbinary.dat", "2\t0\tsrc/app.ts"].join("\n"),
      ),
    ).toEqual({
      changedFiles: 3,
      insertions: 12,
      deletions: 4,
    });
  });
});

describe("parseNumstatEntriesZ", () => {
  it("parses normal and binary entries from NUL-delimited output", () => {
    const output =
      "10\t4\tREADME.md\0" + "-\t-\tbinary.dat\0" + "2\t0\tsrc/app.ts\0";
    expect(parseNumstatEntriesZ(output)).toEqual([
      { path: "README.md", insertions: 10, deletions: 4 },
      { path: "binary.dat", insertions: null, deletions: null },
      { path: "src/app.ts", insertions: 2, deletions: 0 },
    ]);
  });

  it("takes the new path for rename entries", () => {
    const output = "3\t1\t\0src/old.ts\0src/new.ts\0" + "5\t2\tsrc/app.ts\0";
    expect(parseNumstatEntriesZ(output)).toEqual([
      { path: "src/new.ts", insertions: 3, deletions: 1 },
      { path: "src/app.ts", insertions: 5, deletions: 2 },
    ]);
  });
});
