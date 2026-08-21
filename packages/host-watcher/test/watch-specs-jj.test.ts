import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectWorkspaceStatusChanges,
  resolveMetadataWatchSpecs,
} from "../src/watch-specs.js";

const execFileAsync = promisify(execFile);

const jjAvailable = await execFileAsync("jj", ["--version"]).then(
  () => true,
  () => false,
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  // The watch specs resolve symlinks (macOS /tmp -> /private/tmp), so hand
  // tests the real path to make comparisons stable.
  return fs.realpath(dir);
}

async function runJj(args: string[], cwd: string): Promise<void> {
  await execFileAsync("jj", args, { cwd });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe.skipIf(!jjAvailable)("watch specs for colocated jj repos", () => {
  it("watches the real .git dir and classifies bookmark exports as shared ref changes", async () => {
    const repoPath = await makeTempDir("bb-jj-watch-repo-");
    await runJj(["git", "init", "--colocate"], repoPath);
    await runJj(["config", "set", "--repo", "user.name", "BB Tests"], repoPath);
    await runJj(
      ["config", "set", "--repo", "user.email", "bb@example.com"],
      repoPath,
    );
    await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
    await runJj(["commit", "-m", "Initial commit"], repoPath);

    const specs = await resolveMetadataWatchSpecs(repoPath);
    expect(specs).not.toBeNull();
    const gitDirSpec = specs?.find((spec) => spec.kind === "git-dir");
    expect(gitDirSpec).toMatchObject({
      rootPath: path.join(repoPath, ".git"),
      includeSharedGitRefs: true,
    });

    // jj exports a moved bookmark by writing the branch ref into .git; that
    // path must classify as a shared-git-refs change so server caches
    // invalidate on bookmark moves.
    await runJj(["bookmark", "create", "feature", "-r", "@-"], repoPath);
    const exportedRefPath = path.join(
      repoPath,
      ".git",
      "refs",
      "heads",
      "feature",
    );
    await fs.stat(exportedRefPath);

    const change = collectWorkspaceStatusChanges({
      events: [{ path: exportedRefPath, type: "update" }],
      spec: gitDirSpec!,
    });
    expect(change?.changeKinds).toContain("shared-git-refs-changed");
  });
});
