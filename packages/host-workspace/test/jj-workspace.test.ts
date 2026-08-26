import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { JjWorkspace } from "../src/jj-workspace.js";
import {
  attachShadowGitCheckout,
  resolveJjWorkspaceLayout,
  runJj,
  type JjWorkspaceLayout,
} from "../src/jj.js";

const execFileAsync = promisify(execFile);

const jjAvailable = await execFileAsync("jj", ["--version"]).then(
  () => true,
  () => false,
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return await fs.realpath(dir);
}

async function initSource(): Promise<string> {
  const sourcePath = await makeTempDir("bb-jj-source-");
  await runJj(["git", "init", "--colocate"], { cwd: sourcePath });
  await runJj(["config", "set", "--repo", "user.name", "BB Tests"], {
    cwd: sourcePath,
  });
  await runJj(["config", "set", "--repo", "user.email", "bb@example.com"], {
    cwd: sourcePath,
  });
  await fs.writeFile(path.join(sourcePath, "README.md"), "hello\n", "utf8");
  await runJj(["commit", "-m", "Initial commit"], { cwd: sourcePath });
  await runJj(["bookmark", "create", "main", "-r", "@-"], { cwd: sourcePath });
  return sourcePath;
}

async function addWorkspace(
  sourcePath: string,
  bookmark: string,
): Promise<{ workspace: JjWorkspace; workspacePath: string }> {
  const parent = await makeTempDir("bb-jj-workspaces-");
  const workspacePath = path.join(parent, "thread");
  await runJj(
    ["workspace", "add", "--name", bookmark, workspacePath, "-r", "main"],
    { cwd: sourcePath },
  );
  await attachShadowGitCheckout({ sourcePath, workspacePath });
  const layout = (await resolveJjWorkspaceLayout(
    workspacePath,
  )) as JjWorkspaceLayout;
  return {
    workspace: new JjWorkspace({ path: workspacePath, layout, bookmark }),
    workspacePath,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!jjAvailable)("bb-managed jj workspaces", () => {
  it("reports jj's working-copy edits as uncommitted changes", async () => {
    const sourcePath = await initSource();
    const { workspace, workspacePath } = await addWorkspace(
      sourcePath,
      "bb/thread-1",
    );

    expect((await workspace.getStatus()).workingTree.hasUncommittedChanges).toBe(
      false,
    );

    await fs.writeFile(path.join(workspacePath, "README.md"), "edited\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "added.txt"), "added\n", "utf8");

    const status = await workspace.getStatus();
    expect(status.workingTree.hasUncommittedChanges).toBe(true);
    expect(status.workingTree.files.map((file) => file.path).sort()).toEqual([
      "README.md",
      "added.txt",
    ]);
    // The shadow checkout stays detached at @-, with the workspace's bookmark
    // reported for display.
    expect(status.checkout).toMatchObject({ kind: "detached" });
    // .jj is jj's own bookkeeping and must never surface as a change.
    expect(
      status.workingTree.files.some((file) => file.path.startsWith(".jj")),
    ).toBe(false);

    const diff = await workspace.getDiff();
    expect(diff.diff).toContain("added.txt");
    expect(diff.diff).toContain("edited");
  });

  it("commits with jj, moves the bookmark, and exports it to git", async () => {
    const sourcePath = await initSource();
    const { workspace, workspacePath } = await addWorkspace(
      sourcePath,
      "bb/thread-1",
    );
    await fs.writeFile(path.join(workspacePath, "work.txt"), "work\n", "utf8");

    const result = await workspace.commit({
      message: "thread work",
      noVerify: true,
    });
    expect(result.commitSubject).toBe("thread work");

    // The bookmark is a real git ref in the source repository...
    const ref = await runGit(
      ["rev-parse", "--verify", "refs/heads/bb/thread-1"],
      { cwd: sourcePath },
    );
    expect(ref.stdout.trim()).toBe(result.commitSha);
    // ...and jj sees one commit, not a stray anonymous head beside it.
    const heads = await runJj(
      ["log", "--no-graph", "-r", "bb/thread-1", "-T", 'description.first_line() ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(heads.stdout.trim()).toBe("thread work");

    const status = await workspace.getStatus();
    expect(status.workingTree.hasUncommittedChanges).toBe(false);
  });

  it("refuses an empty commit and discards changes on reset", async () => {
    const sourcePath = await initSource();
    const { workspace, workspacePath } = await addWorkspace(
      sourcePath,
      "bb/thread-1",
    );

    await expect(
      workspace.commit({ message: "nothing", noVerify: true }),
    ).rejects.toMatchObject({ name: "WorkspaceError", code: "no_changes" });

    await fs.writeFile(path.join(workspacePath, "junk.txt"), "junk\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "README.md"), "edited\n", "utf8");
    await workspace.reset();

    expect((await workspace.getStatus()).workingTree.hasUncommittedChanges).toBe(
      false,
    );
    await expect(
      fs.readFile(path.join(workspacePath, "README.md"), "utf8"),
    ).resolves.toBe("hello\n");
  });

  it("squash merges committed work into the source repository's branch", async () => {
    const sourcePath = await initSource();
    const { workspace, workspacePath } = await addWorkspace(
      sourcePath,
      "bb/thread-1",
    );
    await fs.writeFile(path.join(workspacePath, "work.txt"), "work\n", "utf8");
    await workspace.commit({ message: "thread work", noVerify: true });

    const merge = await workspace.squashMergeInto({
      targetBranch: "main",
      commitMessage: "squashed thread work",
    });
    expect(merge.merged).toBe(true);

    // jj imports the moved git ref, so main carries the squash commit.
    const mainLog = await runJj(
      ["log", "--no-graph", "-r", "main", "-T", 'description.first_line() ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(mainLog.stdout.trim()).toBe("squashed thread work");
  });

  it("picks up commits an agent made with jj directly", async () => {
    const sourcePath = await initSource();
    const { workspace, workspacePath } = await addWorkspace(
      sourcePath,
      "bb/thread-1",
    );
    await fs.writeFile(path.join(workspacePath, "agent.txt"), "agent\n", "utf8");
    // An agent using jj moves @- without bb involvement; the shadow checkout
    // has to follow before anything reads the workspace.
    await runJj(["commit", "-m", "agent commit"], { cwd: workspacePath });

    const status = await workspace.getStatus();
    expect(status.workingTree.hasUncommittedChanges).toBe(false);
    expect(await workspace.getHeadSha()).toBe(
      (
        await runJj(["log", "--no-graph", "-r", "@-", "-T", "commit_id"], {
          cwd: workspacePath,
        })
      ).stdout.trim(),
    );
  });
});
