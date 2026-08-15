import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "@bb/host-workspace";
import { afterEach, describe, expect, it } from "vitest";
import { isExpectedCommandDispatchError } from "../command-dispatch-support.js";
import { cloneProject, resolveProjectCloneDefaultPath } from "./project.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-project-clone-"));
  tempDirs.push(dir);
  return dir;
}

async function createRemoteRepo(root: string): Promise<string> {
  const source = path.join(root, "source");
  const remote = path.join(root, "remote.git");
  await fs.mkdir(source, { recursive: true });
  await runGit(["init"], { cwd: source });
  await fs.writeFile(path.join(source, "README.md"), "hello\n");
  await runGit(["add", "README.md"], { cwd: source });
  await runGit(
    [
      "-c",
      "user.name=BB Test",
      "-c",
      "user.email=bb@example.test",
      "commit",
      "-m",
      "initial",
    ],
    { cwd: source },
  );
  await runGit(["clone", "--bare", source, remote], { cwd: root });
  return remote;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("project.clone", () => {
  it("clones a real repository and reports the resolved path and origin", async () => {
    const root = await tempDir();
    const remoteUrl = await createRemoteRepo(root);
    const result = await cloneProject({
      dataDir: path.join(root, "data"),
      projectSlug: "My Project",
      remoteUrl,
    });

    expect(result).toEqual({
      path: path.join(root, "data", "checkouts", "my-project"),
      gitRemoteUrl: remoteUrl,
    });
    await expect(
      fs.readFile(path.join(result.path, "README.md"), "utf8"),
    ).resolves.toBe(process.platform === "win32" ? "hello\r\n" : "hello\n");
  });

  it("refuses a non-empty target with a structured error", async () => {
    const root = await tempDir();
    const targetPath = path.join(root, "target");
    await fs.mkdir(targetPath);
    await fs.writeFile(path.join(targetPath, "keep.txt"), "keep");

    const error = await cloneProject({
      dataDir: path.join(root, "data"),
      projectSlug: "project",
      remoteUrl: path.join(root, "remote.git"),
      targetPath,
    }).catch((caught) => caught);
    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect(error).toMatchObject({ code: "target_not_empty" });
  });

  it("preserves git stderr in a structured clone failure", async () => {
    const root = await tempDir();
    const missingRemote = path.join(root, "missing.git");
    const error = await cloneProject({
      dataDir: path.join(root, "data"),
      projectSlug: "project",
      remoteUrl: missingRemote,
    }).catch((caught) => caught);

    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect(error).toMatchObject({ code: "git_command_failed" });
    expect(error.message).toMatch(
      /does not exist|not appear to be a git repository/,
    );
  });

  it("derives the checkout convention without touching the filesystem", async () => {
    const root = await tempDir();
    const dataDir = path.join(root, "data");
    expect(resolveProjectCloneDefaultPath(dataDir, " Project / Name ")).toBe(
      path.join(dataDir, "checkouts", "project-name"),
    );
    await expect(fs.stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
