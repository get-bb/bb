import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runGit } from "bb-environment-provider-host/workspace-git";
import {
  detectLinkedWorktree,
  getCheckoutRef,
  getWorkspaceGitOperation,
  parsePorcelainEntries,
  readGitBlob,
} from "../src/git.js";

const tempDirs: string[] = [];

let templateRepo: string;

beforeAll(async () => {
  templateRepo = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-template-"));
  const repoPath = templateRepo;
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.mkdir(path.join(repoPath, "docs"));
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await fs.writeFile(path.join(repoPath, "docs", "index.md"), "docs\n", "utf8");
  await fs.writeFile(path.join(repoPath, "large.txt"), "0123456789\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
});

afterAll(async () => {
  if (templateRepo) {
    await fs.rm(templateRepo, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

async function initReadGitBlobRepo() {
  const repoPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-read-git-blob-"),
  );
  tempDirs.push(repoPath);
  await fs.cp(templateRepo, repoPath, { recursive: true });
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

describe("getCheckoutRef", () => {
  it("reports the HEAD branch of a bare repository root", async () => {
    const { root } = await initBareWorktreeLayout();
    const head = await runGit(["rev-parse", "HEAD"], { cwd: root });

    await expect(getCheckoutRef(root)).resolves.toEqual({
      kind: "branch",
      branchName: "main",
      headSha: head.stdout.trim(),
    });
  });

  it("reports branch checkouts with HEAD sha", async () => {
    const repoPath = await initReadGitBlobRepo();
    const head = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });

    await expect(getCheckoutRef(repoPath)).resolves.toEqual({
      kind: "branch",
      branchName: "main",
      headSha: head.stdout.trim(),
    });
  });

  it("reports detached HEAD without pretending there is a current branch", async () => {
    const repoPath = await initReadGitBlobRepo();
    const head = await runGit(["rev-parse", "HEAD"], { cwd: repoPath });
    await runGit(["switch", "--detach", "HEAD"], { cwd: repoPath });

    await expect(getCheckoutRef(repoPath)).resolves.toEqual({
      kind: "detached",
      headSha: head.stdout.trim(),
    });
  });

  it("reports unborn branches for empty repositories", async () => {
    const repoPath = await initEmptyRepo();

    await expect(getCheckoutRef(repoPath)).resolves.toEqual({
      kind: "unborn",
      branchName: "main",
    });
  });
});

describe("getWorkspaceGitOperation", () => {
  it("reports no operation for ordinary repositories", async () => {
    const repoPath = await initReadGitBlobRepo();

    await expect(getWorkspaceGitOperation(repoPath)).resolves.toEqual({
      kind: "none",
    });
  });

  it("reports merge conflicts", async () => {
    const repoPath = await initConflictRepo();
    const merge = await runGit(["merge", "feature"], {
      cwd: repoPath,
      allowFailure: true,
    });
    expect(merge.exitCode).not.toBe(0);

    await expect(getWorkspaceGitOperation(repoPath)).resolves.toEqual({
      kind: "merge",
      hasConflicts: true,
    });
  });

  it("reports rebase conflicts", async () => {
    const repoPath = await initConflictRepo();
    await runGit(["switch", "feature"], { cwd: repoPath });
    const rebase = await runGit(["rebase", "main"], {
      cwd: repoPath,
      allowFailure: true,
    });
    expect(rebase.exitCode).not.toBe(0);

    await expect(getWorkspaceGitOperation(repoPath)).resolves.toEqual({
      kind: "rebase",
      hasConflicts: true,
    });
  });
});

describe("readGitBlob", () => {
  it("reads a blob at a git ref and reports the returned byte size", async () => {
    const repoPath = await initReadGitBlobRepo();

    const blob = await readGitBlob(repoPath, "HEAD", "README.md", 1024);

    expect(blob.contents?.toString("utf8")).toBe("hello\n");
    expect(blob.sizeBytes).toBe(Buffer.byteLength("hello\n"));
  });

  it("returns null contents for a missing blob path", async () => {
    const repoPath = await initReadGitBlobRepo();

    await expect(
      readGitBlob(repoPath, "HEAD", "missing.txt", 1024),
    ).resolves.toEqual({
      contents: null,
      sizeBytes: 0,
    });
  });

  it("returns null contents for a missing ref", async () => {
    const repoPath = await initReadGitBlobRepo();

    await expect(
      readGitBlob(repoPath, "missing-ref", "README.md", 1024),
    ).resolves.toEqual({
      contents: null,
      sizeBytes: 0,
    });
  });

  it("rejects non-blob git objects instead of treating them as missing", async () => {
    const repoPath = await initReadGitBlobRepo();

    await expect(
      readGitBlob(repoPath, "HEAD", "docs", 1024),
    ).rejects.toMatchObject({
      code: "git_command_failed",
    });
  });

  it("allows blobs exactly at the byte cap", async () => {
    const repoPath = await initReadGitBlobRepo();

    const blob = await readGitBlob(repoPath, "HEAD", "large.txt", 11);

    expect(blob.contents?.toString("utf8")).toBe("0123456789\n");
    expect(blob.sizeBytes).toBe(11);
  });

  it("rejects oversized blobs during size preflight", async () => {
    const repoPath = await initReadGitBlobRepo();

    await expect(
      readGitBlob(repoPath, "HEAD", "large.txt", 4),
    ).rejects.toMatchObject({
      code: "blob_too_large",
      message: "Blob size 11 bytes exceeds the 0 MB limit",
    });
  });
});

describe("parsePorcelainEntries", () => {
  it("parses ordinary entries and renamed targets", () => {
    expect(
      parsePorcelainEntries(
        [
          " M README.md",
          "R  old-name.ts -> new-name.ts",
          "D  removed.txt",
        ].join("\n"),
      ),
    ).toEqual([
      {
        path: "README.md",
        status: "M",
        indexStatus: " ",
        worktreeStatus: "M",
      },
      {
        path: "new-name.ts",
        status: "R",
        indexStatus: "R",
        worktreeStatus: " ",
      },
      {
        path: "removed.txt",
        status: "D",
        indexStatus: "D",
        worktreeStatus: " ",
      },
    ]);
  });

  it("decodes quoted git paths and octal escapes", () => {
    expect(
      parsePorcelainEntries(
        [
          '?? "a b.txt"',
          '?? "quote\\\\and\\\"slash.txt"',
          'R  "old\\040name.txt" -> "new\\040name.txt"',
        ].join("\n"),
      ),
    ).toEqual([
      {
        path: "a b.txt",
        status: "??",
        indexStatus: "?",
        worktreeStatus: "?",
      },
      {
        path: 'quote\\and"slash.txt',
        status: "??",
        indexStatus: "?",
        worktreeStatus: "?",
      },
      {
        path: "new name.txt",
        status: "R",
        indexStatus: "R",
        worktreeStatus: " ",
      },
    ]);
  });
});

describe("detectLinkedWorktree", () => {
  it("tells a linked worktree apart from an ordinary checkout", async () => {
    const { worktreePath } = await initBareWorktreeLayout();
    const ordinaryCheckout = await initReadGitBlobRepo();
    const plainDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-plain-wt-"));
    tempDirs.push(plainDir);

    await expect(detectLinkedWorktree(worktreePath)).resolves.toBe(true);
    await expect(detectLinkedWorktree(ordinaryCheckout)).resolves.toBe(false);
    await expect(detectLinkedWorktree(plainDir)).resolves.toBe(false);
  });
});
