import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace.js";
import { runGit } from "../src/git.js";
import type { RawDiffFileStat, WorkspaceDiffTarget } from "@bb/domain";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-diff-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await runGit(["config", "core.autocrlf", "false"], { cwd: repoPath });
  return repoPath;
}

async function write(
  repoPath: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const full = path.join(repoPath, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents, "utf8");
}

async function writeBytes(
  repoPath: string,
  relativePath: string,
  bytes: Buffer,
): Promise<void> {
  const full = path.join(repoPath, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
}

async function commitAll(repoPath: string, message: string): Promise<void> {
  await runGit(["add", "-A"], { cwd: repoPath });
  await runGit(["commit", "-m", message], { cwd: repoPath });
}

function findFile(
  files: RawDiffFileStat[],
  filePath: string,
): RawDiffFileStat | undefined {
  return files.find((file) => file.path === filePath);
}

const UNCOMMITTED: WorkspaceDiffTarget = { type: "uncommitted" };

/**
 * Reads the full diff for a target, then splits it per-file the same way the
 * production splitter does, so a per-path patch can be compared byte-for-byte
 * against the corresponding slice of the full diff.
 */
async function fullDiffSectionFor(
  workspace: Workspace,
  target: WorkspaceDiffTarget,
  newPath: string,
): Promise<string> {
  const full = await workspace.getDiff({ target });
  const sections = splitFullDiff(full.diff);
  return sections.get(newPath) ?? "";
}

function splitFullDiff(combinedDiff: string): Map<string, string> {
  const byPath = new Map<string, string>();
  const lines = combinedDiff.split("\n");
  let currentPath: string | null = null;
  let currentLines: string[] = [];
  const flush = (): void => {
    if (currentPath !== null) {
      byPath.set(currentPath, formatDiffSection(currentLines));
    }
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const body = line.slice("diff --git ".length);
      const separator = body.lastIndexOf(" b/");
      currentPath = separator === -1 ? null : body.slice(separator + 3);
      currentLines = [line];
      continue;
    }
    if (currentPath !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return byPath;
}

/** Mirror of the production trailing-empty-line normalization. */
function formatDiffSection(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }
  if (end === 0) {
    return "";
  }
  return `${lines.slice(0, end).join("\n")}\n`;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("Workspace.diffFiles", () => {
  it("reports additions, modifications, and deletions with numstat counts", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "keep.txt", "a\nb\nc\n");
    await write(repoPath, "remove.txt", "x\ny\n");
    await commitAll(repoPath, "base");

    await write(repoPath, "keep.txt", "a\nB\nc\nd\n");
    await write(repoPath, "added.txt", "new\nfile\n");
    await fs.rm(path.join(repoPath, "remove.txt"));
    // Stage the new file so it is a tracked addition (vs. an untracked file)
    // in the `git diff HEAD` the uncommitted target computes.
    await runGit(["add", "added.txt"], { cwd: repoPath });

    const workspace = new Workspace(repoPath);
    const result = await workspace.diffFiles({ target: UNCOMMITTED });

    const added = findFile(result.files, "added.txt");
    expect(added).toEqual({
      path: "added.txt",
      previousPath: null,
      statusLetter: "A",
      additions: 2,
      deletions: 0,
      binary: false,
      origin: "tracked",
    });

    const modified = findFile(result.files, "keep.txt");
    expect(modified?.statusLetter).toBe("M");
    expect(modified?.additions).toBe(2);
    expect(modified?.deletions).toBe(1);

    const deleted = findFile(result.files, "remove.txt");
    expect(deleted?.statusLetter).toBe("D");
    expect(deleted?.additions).toBe(0);
    expect(deleted?.deletions).toBe(2);

    expect(result.shortstat).toContain("changed");
    expect(result.mergeBaseRef).toBeNull();
  });

  it("detects renames with previousPath and copies", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "original.txt", "line1\nline2\nline3\nline4\n");
    await commitAll(repoPath, "base");

    await runGit(["mv", "original.txt", "renamed.txt"], { cwd: repoPath });
    await commitAll(repoPath, "rename");

    const workspace = new Workspace(repoPath);
    const result = await workspace.diffFiles({
      target: { type: "commit", sha: "HEAD" },
    });

    const renamed = findFile(result.files, "renamed.txt");
    expect(renamed?.statusLetter).toBe("R");
    expect(renamed?.previousPath).toBe("original.txt");
  });

  it("detects a type change (file to symlink) as statusLetter T", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "target.txt", "hello\n");
    await write(repoPath, "thing", "i am a regular file\n");
    await commitAll(repoPath, "base");

    await fs.rm(path.join(repoPath, "thing"));
    await fs.symlink("target.txt", path.join(repoPath, "thing"));

    const workspace = new Workspace(repoPath);
    const result = await workspace.diffFiles({ target: UNCOMMITTED });

    const typeChanged = findFile(result.files, "thing");
    expect(typeChanged?.statusLetter).toBe("T");
  });

  it("marks binary files with binary:true and zero counts", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "readme.txt", "text\n");
    await commitAll(repoPath, "base");

    await writeBytes(
      repoPath,
      "image.bin",
      Buffer.from([0, 1, 2, 0, 255, 254, 0, 10, 0]),
    );

    const workspace = new Workspace(repoPath);
    const result = await workspace.diffFiles({ target: UNCOMMITTED });

    const binary = findFile(result.files, "image.bin");
    expect(binary?.binary).toBe(true);
    expect(binary?.additions).toBe(0);
    expect(binary?.deletions).toBe(0);
    expect(binary?.origin).toBe("untracked");
  });

  it("includes untracked files tagged origin:untracked for uncommitted target", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "tracked.txt", "one\n");
    await commitAll(repoPath, "base");

    await write(repoPath, "tracked.txt", "one\ntwo\n");
    await write(repoPath, "untracked.txt", "fresh\ncontent\n");

    const workspace = new Workspace(repoPath);
    const result = await workspace.diffFiles({ target: UNCOMMITTED });

    const tracked = findFile(result.files, "tracked.txt");
    expect(tracked?.origin).toBe("tracked");

    const untracked = findFile(result.files, "untracked.txt");
    expect(untracked).toEqual({
      path: "untracked.txt",
      previousPath: null,
      statusLetter: "A",
      additions: 2,
      deletions: 0,
      binary: false,
      origin: "untracked",
    });
  });

  it("does not include untracked files for a commit target", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "a.txt", "a\n");
    await commitAll(repoPath, "base");
    await write(repoPath, "b.txt", "b\n");
    await commitAll(repoPath, "second");
    await write(repoPath, "untracked.txt", "loose\n");

    const workspace = new Workspace(repoPath);
    const result = await workspace.diffFiles({
      target: { type: "commit", sha: "HEAD" },
    });

    expect(findFile(result.files, "b.txt")).toBeDefined();
    expect(findFile(result.files, "untracked.txt")).toBeUndefined();
  });
});

describe("Workspace.diffPatch", () => {
  const BIG_BUDGET = 10_000_000;

  it("returns a tracked file patch matching the full-diff slice byte-for-byte", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "alpha.txt", "1\n2\n3\n");
    await write(repoPath, "beta.txt", "x\ny\n");
    await commitAll(repoPath, "base");

    await write(repoPath, "alpha.txt", "1\nTWO\n3\n4\n");
    await write(repoPath, "beta.txt", "x\nY\n");

    const workspace = new Workspace(repoPath);
    const expected = await fullDiffSectionFor(
      workspace,
      UNCOMMITTED,
      "alpha.txt",
    );
    const patches = await workspace.diffPatch({
      target: UNCOMMITTED,
      paths: ["alpha.txt"],
      maxBytesPerFile: BIG_BUDGET,
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]?.path).toBe("alpha.txt");
    expect(patches[0]?.truncated).toBe(false);
    expect(patches[0]?.patch).toBe(expected);
    // The subset must not bleed the other changed file into the patch.
    expect(patches[0]?.patch).not.toContain("beta.txt");
  });

  it("preserves rename detection in a path-subset patch", async () => {
    const repoPath = await initRepo();
    await write(
      repoPath,
      "original.txt",
      "alpha\nbeta\ngamma\ndelta\nepsilon\n",
    );
    await commitAll(repoPath, "base");

    await runGit(["mv", "original.txt", "renamed.txt"], { cwd: repoPath });
    await write(
      repoPath,
      "renamed.txt",
      "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n",
    );
    await commitAll(repoPath, "rename with edit");

    const target: WorkspaceDiffTarget = { type: "commit", sha: "HEAD" };
    const workspace = new Workspace(repoPath);

    const expected = await fullDiffSectionFor(workspace, target, "renamed.txt");
    const patches = await workspace.diffPatch({
      target,
      paths: ["renamed.txt"],
      maxBytesPerFile: BIG_BUDGET,
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch).toBe(expected);
    // Rename detection intact: a rename header, not an add+delete pair.
    expect(patches[0]?.patch).toMatch(/rename from original\.txt/);
    expect(patches[0]?.patch).toMatch(/rename to renamed\.txt/);
  });

  it("renders untracked files via the no-index path", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "tracked.txt", "base\n");
    await commitAll(repoPath, "base");
    await write(repoPath, "untracked.txt", "new\nfile\nhere\n");

    const workspace = new Workspace(repoPath);
    const patches = await workspace.diffPatch({
      target: UNCOMMITTED,
      paths: ["untracked.txt"],
      maxBytesPerFile: BIG_BUDGET,
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]?.path).toBe("untracked.txt");
    expect(patches[0]?.patch).toContain("+new");
    expect(patches[0]?.patch).toContain("+file");
    expect(patches[0]?.patch).toContain("+here");
    expect(patches[0]?.patch.length).toBeGreaterThan(0);
  });

  it("matches the full-diff slice for an untracked file", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "tracked.txt", "base\n");
    await commitAll(repoPath, "base");
    await write(repoPath, "untracked.txt", "alpha\nbeta\n");

    const workspace = new Workspace(repoPath);
    const expected = await fullDiffSectionFor(
      workspace,
      UNCOMMITTED,
      "untracked.txt",
    );
    const patches = await workspace.diffPatch({
      target: UNCOMMITTED,
      paths: ["untracked.txt"],
      maxBytesPerFile: BIG_BUDGET,
    });

    expect(patches[0]?.patch).toBe(expected);
  });

  it("returns patches for a mixed tracked + untracked subset", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "tracked.txt", "1\n2\n");
    await commitAll(repoPath, "base");
    await write(repoPath, "tracked.txt", "1\n2\n3\n");
    await write(repoPath, "untracked.txt", "loose\n");

    const workspace = new Workspace(repoPath);
    const patches = await workspace.diffPatch({
      target: UNCOMMITTED,
      paths: ["untracked.txt", "tracked.txt"],
      maxBytesPerFile: BIG_BUDGET,
    });

    // Requested order is preserved.
    expect(patches.map((entry) => entry.path)).toEqual([
      "untracked.txt",
      "tracked.txt",
    ]);
    expect(patches[0]?.patch).toContain("+loose");
    expect(patches[1]?.patch).toContain("+3");
  });

  it("truncates a patch exceeding maxBytesPerFile and sets truncated", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "base.txt", "seed\n");
    await commitAll(repoPath, "base");

    const longBody = Array.from(
      { length: 200 },
      (_unused, index) => `line ${index}`,
    ).join("\n");
    await write(repoPath, "big.txt", `${longBody}\n`);

    const workspace = new Workspace(repoPath);
    const [entry] = await workspace.diffPatch({
      target: UNCOMMITTED,
      paths: ["big.txt"],
      maxBytesPerFile: 100,
    });

    expect(entry?.truncated).toBe(true);
    expect(Buffer.byteLength(entry?.patch ?? "", "utf8")).toBeLessThanOrEqual(
      100,
    );
  });

  it("matches the full-diff slice for a branch_committed rename target", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "mod.txt", "stable\n");
    await write(repoPath, "before.txt", "one\ntwo\nthree\nfour\n");
    await commitAll(repoPath, "base");
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await runGit(["mv", "before.txt", "after.txt"], { cwd: repoPath });
    await write(repoPath, "mod.txt", "stable\nmore\n");
    await commitAll(repoPath, "feature work");

    const target: WorkspaceDiffTarget = {
      type: "branch_committed",
      mergeBaseBranch: "main",
    };
    const workspace = new Workspace(repoPath);

    const expectedRename = await fullDiffSectionFor(
      workspace,
      target,
      "after.txt",
    );
    const expectedMod = await fullDiffSectionFor(workspace, target, "mod.txt");

    const patches = await workspace.diffPatch({
      target,
      paths: ["after.txt", "mod.txt"],
      maxBytesPerFile: BIG_BUDGET,
    });

    expect(patches.find((p) => p.path === "after.txt")?.patch).toBe(
      expectedRename,
    );
    expect(patches.find((p) => p.path === "mod.txt")?.patch).toBe(expectedMod);
  });

  it("ignores requested paths that are not in the target's changes", async () => {
    const repoPath = await initRepo();
    await write(repoPath, "real.txt", "a\n");
    await commitAll(repoPath, "base");
    await write(repoPath, "real.txt", "a\nb\n");

    const workspace = new Workspace(repoPath);
    const patches = await workspace.diffPatch({
      target: UNCOMMITTED,
      paths: ["real.txt", "does-not-exist.txt"],
      maxBytesPerFile: 10_000_000,
    });

    expect(patches.map((p) => p.path)).toEqual([
      "real.txt",
      "does-not-exist.txt",
    ]);
    expect(patches.find((p) => p.path === "real.txt")?.patch).toContain("+b");
    // A path with no changes yields an empty patch rather than an error.
    expect(patches.find((p) => p.path === "does-not-exist.txt")?.patch).toBe("");
  });
});
