import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommandDispatchError,
  type CommandOf,
  isExpectedCommandDispatchError,
} from "../command-dispatch-support.js";
import {
  readHostFile,
  readHostFileMetadata,
  readHostRelativeFile,
  writeHostRelativeFile,
  deleteHostRelativeFile,
  deleteHostRelativePath,
} from "./host-files.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runGit(
  args: readonly string[],
  options: { cwd: string },
): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd: options.cwd });
  return result.stdout;
}

async function initRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-host-files-test-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  return repoPath;
}

async function captureReadHostFileError(
  command: CommandOf<"host.read_file">,
): Promise<unknown> {
  try {
    await readHostFile(command);
  } catch (error) {
    return error;
  }

  throw new Error("Expected readHostFile to fail");
}

async function captureReadHostRelativeFileError(
  command: CommandOf<"host.read_file_relative">,
): Promise<unknown> {
  try {
    await readHostRelativeFile(command);
  } catch (error) {
    return error;
  }

  throw new Error("Expected readHostRelativeFile to fail");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("readHostFile (no ref — disk read)", () => {
  it("reads explicit file contents from disk without a rootPath", async () => {
    const repoPath = await initRepo();
    const filePath = path.join(repoPath, "host-notes.md");
    await fs.writeFile(filePath, "host notes", "utf8");

    const result = await readHostFile({
      type: "host.read_file",
      path: filePath,
    });

    expect(result.path).toBe(filePath);
    expect(result.content).toBe("host notes");
    expect(result.contentEncoding).toBe("utf8");
    expect(result.sizeBytes).toBe(10);
  });

  it("reads file contents from disk", async () => {
    const repoPath = await initRepo();
    const filePath = path.join(repoPath, "hello.txt");
    await fs.writeFile(filePath, "hello world", "utf8");

    const result = await readHostFile({
      type: "host.read_file",
      path: filePath,
      rootPath: repoPath,
    });

    expect(result.content).toBe("hello world");
    expect(result.contentEncoding).toBe("utf8");
    expect(result.sizeBytes).toBe(11);
  });

  it("rejects relative paths", async () => {
    await expect(
      readHostFile({
        type: "host.read_file",
        path: "relative/file.txt",
        rootPath: "/tmp",
      }),
    ).rejects.toBeInstanceOf(CommandDispatchError);
  });

  it("marks missing targets under an existing root as expected", async () => {
    const repoPath = await initRepo();
    const missingPath = path.join(repoPath, "notes.md");
    const thrown = await captureReadHostFileError({
      type: "host.read_file",
      path: missingPath,
      rootPath: repoPath,
    });

    expect(thrown).toBeInstanceOf(CommandDispatchError);
    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: `Path does not exist: ${missingPath}`,
      name: "ExpectedCommandDispatchError",
    });
    expect(isExpectedCommandDispatchError(thrown)).toBe(true);
  });

  it("marks missing rootless targets as expected", async () => {
    const repoPath = await initRepo();
    const missingPath = path.join(repoPath, "HOST-NOTES.md");
    const thrown = await captureReadHostFileError({
      type: "host.read_file",
      path: missingPath,
    });

    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: `Path does not exist: ${missingPath}`,
      name: "ExpectedCommandDispatchError",
    });
    expect(isExpectedCommandDispatchError(thrown)).toBe(true);
  });

  it("marks missing roots as expected", async () => {
    const parentPath = await makeTempDir("bb-host-files-missing-root-");
    const rootPath = path.join(parentPath, "missing-root");
    const missingPath = path.join(rootPath, "notes.md");
    const thrown = await captureReadHostFileError({
      type: "host.read_file",
      path: missingPath,
      rootPath,
    });

    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: `Path does not exist: ${missingPath}`,
      name: "ExpectedCommandDispatchError",
    });
    expect(isExpectedCommandDispatchError(thrown)).toBe(true);
  });

  it("marks missing relative read roots as expected", async () => {
    const parentPath = await makeTempDir("bb-host-files-relative-root-");
    const rootPath = path.join(parentPath, "STATUS");
    const thrown = await captureReadHostRelativeFileError({
      type: "host.read_file_relative",
      rootPath,
      path: "index.html",
      dotfiles: "deny",
    });

    expect(thrown).toMatchObject({
      code: "ENOENT",
      message: "Path does not exist: index.html",
      name: "ExpectedCommandDispatchError",
    });
    expect(isExpectedCommandDispatchError(thrown)).toBe(true);
  });

  it("rejects rootless directory paths", async () => {
    const repoPath = await initRepo();

    await expect(
      readHostFile({
        type: "host.read_file",
        path: repoPath,
      }),
    ).rejects.toMatchObject({
      code: "invalid_path",
      message: "Path is a directory, not a file",
    });
  });
});

describe("readHostFileMetadata", () => {
  it("returns host-side file metadata without reading contents", async () => {
    const repoPath = await initRepo();
    const filePath = path.join(repoPath, "large-preferences.md");
    await fs.writeFile(filePath, Buffer.alloc(25 * 1024 * 1024 + 1));

    const result = await readHostFileMetadata({
      type: "host.file_metadata",
      path: filePath,
      rootPath: repoPath,
    });

    expect(result.path).toBe(filePath);
    expect(result.sizeBytes).toBe(25 * 1024 * 1024 + 1);
    expect(result.modifiedAtMs).toBeGreaterThan(0);
  });

  it("uses the same containment checks as disk reads", async () => {
    const repoPath = await initRepo();
    const outsidePath = path.join(repoPath, "..", "outside-metadata.txt");
    const symlinkPath = path.join(repoPath, "outside-link");
    await fs.writeFile(outsidePath, "outside");
    await fs.symlink(outsidePath, symlinkPath);

    await expect(
      readHostFileMetadata({
        type: "host.file_metadata",
        path: symlinkPath,
        rootPath: repoPath,
      }),
    ).rejects.toMatchObject({
      code: "invalid_path",
      message: expect.stringContaining("escapes read root"),
    });
  });
});

describe("writeHostRelativeFile and deleteHostRelativeFile", () => {
  it("writes JSON bytes beneath the root and returns a content hash", async () => {
    const rootPath = await makeTempDir("bb-host-relative-write-");
    const content = '{"ok":true}\n';
    const result = await writeHostRelativeFile({
      type: "host.write_file_relative",
      rootPath,
      path: "data/state.json",
      dotfiles: "deny",
      content,
      contentEncoding: "utf8",
    });

    expect(result).toMatchObject({
      path: "data/state.json",
      hash: createHash("sha256").update(content).digest("hex"),
      sizeBytes: Buffer.byteLength(content),
    });
    await expect(
      fs.readFile(path.join(rootPath, "data/state.json"), "utf8"),
    ).resolves.toBe(content);
  });

  it("rejects traversal, dotfiles, directories, and symlink targets", async () => {
    const rootPath = await makeTempDir("bb-host-relative-invalid-");
    await fs.mkdir(path.join(rootPath, "nested"));
    await fs.writeFile(path.join(rootPath, "outside.json"), "outside", "utf8");
    await fs.symlink(
      path.join(rootPath, "outside.json"),
      path.join(rootPath, "nested", "link.json"),
    );

    await expect(
      writeHostRelativeFile({
        type: "host.write_file_relative",
        rootPath,
        path: "../escape.json",
        dotfiles: "deny",
        content: "{}\n",
        contentEncoding: "utf8",
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });

    await expect(
      writeHostRelativeFile({
        type: "host.write_file_relative",
        rootPath,
        path: ".hidden.json",
        dotfiles: "deny",
        content: "{}\n",
        contentEncoding: "utf8",
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      writeHostRelativeFile({
        type: "host.write_file_relative",
        rootPath,
        path: "nested",
        dotfiles: "deny",
        content: "{}\n",
        contentEncoding: "utf8",
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });

    await expect(
      writeHostRelativeFile({
        type: "host.write_file_relative",
        rootPath,
        path: "nested/link.json",
        dotfiles: "deny",
        content: "{}\n",
        contentEncoding: "utf8",
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("deletes files idempotently", async () => {
    const rootPath = await makeTempDir("bb-host-relative-delete-");
    const written = await writeHostRelativeFile({
      type: "host.write_file_relative",
      rootPath,
      path: "tasks.json",
      dotfiles: "deny",
      content: "[]\n",
      contentEncoding: "utf8",
    });

    const deleted = await deleteHostRelativeFile({
      type: "host.delete_file_relative",
      rootPath,
      path: "tasks.json",
      dotfiles: "deny",
    });
    expect(deleted).toEqual({
      path: "tasks.json",
      deleted: true,
      previousHash: written.hash,
    });
    await expect(
      fs.stat(path.join(rootPath, "tasks.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      deleteHostRelativeFile({
        type: "host.delete_file_relative",
        rootPath,
        path: "tasks.json",
        dotfiles: "deny",
      }),
    ).resolves.toEqual({
      path: "tasks.json",
      deleted: false,
      previousHash: null,
    });
  });

  it("deletes directories recursively beneath the root", async () => {
    const rootPath = await makeTempDir("bb-host-relative-delete-dir-");
    await fs.mkdir(path.join(rootPath, "apps", "demo", "assets"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(rootPath, "apps", "demo", "manifest.json"),
      "{}\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(rootPath, "apps", "demo", "assets", "index.html"),
      "<h1>Demo</h1>",
      "utf8",
    );

    await expect(
      deleteHostRelativePath({
        type: "host.delete_path_relative",
        rootPath: path.join(rootPath, "apps"),
        path: "demo",
        dotfiles: "deny",
      }),
    ).resolves.toEqual({
      path: "demo",
      deleted: true,
    });
    await expect(
      fs.stat(path.join(rootPath, "apps", "demo")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      deleteHostRelativePath({
        type: "host.delete_path_relative",
        rootPath: path.join(rootPath, "apps"),
        path: "demo",
        dotfiles: "deny",
      }),
    ).resolves.toEqual({
      path: "demo",
      deleted: false,
    });
  });
});

describe("readHostFile (with ref — git history read)", () => {
  it("rejects ref reads without rootPath", async () => {
    const repoPath = await initRepo();

    await expect(
      readHostFile({
        type: "host.read_file",
        path: path.join(repoPath, "tracked.txt"),
        ref: "HEAD",
      }),
    ).rejects.toMatchObject({
      code: "invalid_path",
      message: "rootPath is required when ref is set",
    });
  });

  it("reads file contents at a specific ref", async () => {
    const repoPath = await initRepo();
    const filePath = path.join(repoPath, "tracked.txt");
    await fs.writeFile(filePath, "version 1\n", "utf8");
    await runGit(["add", "tracked.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "v1"], { cwd: repoPath });

    // Mutate on disk so HEAD differs from the working tree.
    await fs.writeFile(filePath, "version 2\n", "utf8");

    const result = await readHostFile({
      type: "host.read_file",
      path: filePath,
      rootPath: repoPath,
      ref: "HEAD",
    });

    expect(result.content).toBe("version 1\n");
    expect(result.contentEncoding).toBe("utf8");
    expect(result.sizeBytes).toBe(10);
  });

  it("returns empty content when the file does not exist at the ref", async () => {
    const repoPath = await initRepo();
    // Create initial commit so HEAD exists.
    await fs.writeFile(path.join(repoPath, "seed.txt"), "seed\n", "utf8");
    await runGit(["add", "seed.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "seed"], { cwd: repoPath });

    const result = await readHostFile({
      type: "host.read_file",
      path: path.join(repoPath, "missing.txt"),
      rootPath: repoPath,
      ref: "HEAD",
    });

    expect(result.content).toBe("");
    expect(result.sizeBytes).toBe(0);
  });

  it("rejects unsafe refs (path traversal)", async () => {
    const repoPath = await initRepo();
    await fs.writeFile(path.join(repoPath, "f.txt"), "x", "utf8");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "init"], { cwd: repoPath });

    await expect(
      readHostFile({
        type: "host.read_file",
        path: path.join(repoPath, "f.txt"),
        rootPath: repoPath,
        ref: "HEAD/../foo",
      }),
    ).rejects.toBeInstanceOf(CommandDispatchError);
  });

  it("rejects refs with leading dash", async () => {
    const repoPath = await initRepo();
    await expect(
      readHostFile({
        type: "host.read_file",
        path: path.join(repoPath, "f.txt"),
        rootPath: repoPath,
        ref: "-rf",
      }),
    ).rejects.toBeInstanceOf(CommandDispatchError);
  });

  it("rejects paths outside rootPath", async () => {
    const repoPath = await initRepo();
    await fs.writeFile(path.join(repoPath, "seed.txt"), "x", "utf8");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "init"], { cwd: repoPath });

    await expect(
      readHostFile({
        type: "host.read_file",
        path: "/etc/passwd",
        rootPath: repoPath,
        ref: "HEAD",
      }),
    ).rejects.toBeInstanceOf(CommandDispatchError);
  });

  it("reads at a commit SHA other than HEAD", async () => {
    const repoPath = await initRepo();
    const filePath = path.join(repoPath, "tracked.txt");
    await fs.writeFile(filePath, "first\n", "utf8");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "first"], { cwd: repoPath });
    const firstSha = (
      await runGit(["rev-parse", "HEAD"], { cwd: repoPath })
    ).trim();

    await fs.writeFile(filePath, "second\n", "utf8");
    await runGit(["commit", "-am", "second"], { cwd: repoPath });

    const result = await readHostFile({
      type: "host.read_file",
      path: filePath,
      rootPath: repoPath,
      ref: firstSha,
    });

    expect(result.content).toBe("first\n");
  });
});
