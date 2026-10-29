import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { runGit } from "bb-environment-provider-host/workspace-git";
import { WorkspaceReads } from "./workspace-reads.js";

let freshReads = 0;
function fresh() {
  freshReads += 1;
  return { work: `copy-work-${freshReads}`, refs: `copy-refs-${freshReads}` };
}

const UNCOMMITTED = { type: "uncommitted" } as const;
const STATUS_BUDGET = {
  maxUntrackedLineStatFiles: 50,
  maxUntrackedLineStatBytes: 1024 * 1024,
};

function changedFiles(reads: WorkspaceReads) {
  return reads
    .diffFiles({
      freshness: fresh(),
      target: UNCOMMITTED,
      maxFiles: 50,
      ignoreWhitespace: false,
    })
    .then((result) =>
      result.files.map((file) => `${file.statusLetter} ${file.path}`),
    );
}

async function startOfSecond(): Promise<void> {
  const remainder = 1_000 - (Date.now() % 1_000);
  await new Promise((resolve) => setTimeout(resolve, remainder + 20));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.skipIf(process.platform === "win32")("WorkspaceReads index copy", () => {
  it("sees a same-size rewrite made in the second of git add", async () => {
    const repo = await initRepo(await makeTempDir("bb-index-copy-racy-"));
    await fs.writeFile(path.join(repo, "f.txt"), "cccc\n");
    await runGit(["add", "f.txt"], { cwd: repo });
    await runGit(["commit", "-m", "f"], { cwd: repo });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await startOfSecond();
    await fs.writeFile(path.join(repo, "f.txt"), "bbbb\n");
    await runGit(["add", "f.txt"], { cwd: repo });
    await fs.writeFile(path.join(repo, "f.txt"), "cccc\n");
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(await changedFiles(new WorkspaceReads(repo, tmpdir()))).toEqual([]);
  });

  it("keeps the index copy until reads using it finish when disposed mid-read", async () => {
    const repo = await initRepo(await makeTempDir("bb-index-copy-dispose-"));
    await fs.writeFile(path.join(repo, "README.md"), "edited\n");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const shimDir = await makeTempDir("bb-git-slow-diff-");
    const marker = path.join(shimDir, "diff-started");
    await fs.writeFile(
      path.join(shimDir, "git"),
      `#!/bin/sh\ncase " $* " in *" diff "*) touch "${marker}"; sleep 0.5;; esac\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`);
    const reads = new WorkspaceReads(repo, tmpdir());
    const pending = changedFiles(reads);
    await vi.waitFor(() => fs.access(marker), { timeout: 5_000, interval: 20 });
    await reads.dispose();

    expect(await pending).toEqual(["M README.md"]);
  });

  it("writes no shared index into the repository when core.splitIndex is on", async () => {
    const repo = await initRepo(await makeTempDir("bb-index-copy-split-"));
    await runGit(["config", "core.splitIndex", "true"], { cwd: repo });
    await runGit(["update-index", "--split-index"], { cwd: repo });
    await fs.writeFile(path.join(repo, "README.md"), "edited\n");
    await fs.writeFile(path.join(repo, "new.txt"), "new\n");
    const sharedIndexes = async () =>
      (await fs.readdir(path.join(repo, ".git"))).filter((name) =>
        name.startsWith("sharedindex."),
      );
    const before = await sharedIndexes();
    const reads = new WorkspaceReads(repo, tmpdir());

    await reads.getStatus({ freshness: fresh(), ...STATUS_BUDGET });
    expect((await changedFiles(reads)).sort()).toEqual([
      "A new.txt",
      "M README.md",
    ]);
    expect(await sharedIndexes()).toEqual(before);
  });

  it("re-reads an untracked file whose same-tick rewrite keeps its stat signature", async () => {
    const repo = await initRepo(await makeTempDir("bb-index-copy-tick-"));
    const file = path.join(repo, "notes.txt");
    await fs.writeFile(file, "one\n");
    const tick = Math.floor(Date.now() / 1_000) * 1_000;
    const realLstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(async (target, options) => {
      const stats = await realLstat(target, options);
      if (target !== file) return stats;
      return Object.assign(stats, { mtimeMs: tick, ctimeMs: tick, ino: 1 });
    });
    const reads = new WorkspaceReads(repo, tmpdir());
    const untracked = async () =>
      (
        await reads.getStatus({ freshness: fresh(), ...STATUS_BUDGET })
      ).workingTree.files.find((entry) => entry.path === "notes.txt");

    expect(await untracked()).toMatchObject({ insertions: 1 });
    await fs.writeFile(file, "a\nb\n");
    expect(await untracked()).toMatchObject({ insertions: 2 });
  });
});
