import fs from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
} from "../../src/command-dispatch.js";
import {
  createFakeWorkspace,
  createHarness,
  runGitCommand,
} from "./dispatch-helpers.js";

describe("workspace command dispatch", () => {
  it("commits through the resolved workspace runtime", async () => {
    const harness = createHarness();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });

    const commitResult = await dispatchCommand(
      {
        type: "workspace.commit",
        environmentId: "env-1",
        workspaceContext: { workspacePath: "/tmp/env-1" },
        message: "Commit message",
      },
      harness.dispatchOptions(),
    );

    expect(commitResult).toEqual({
      commitSha: "commit-1",
      commitSubject: "Commit message",
    });
    expect(harness.workspaceState.lastCommitMessage).toBe("Commit message");
  });

  it("uses a repository added after the runtime cached a plain workspace", async () => {
    const workspacePath = await makeTempDir("bb-runtime-late-git-");
    const harness = createHarness({ workspacePath });
    harness.workspace.isGitRepo = false;
    await harness.manager.ensureEnvironment({
      environmentId: "env-late-git",
      workspacePath,
    });
    await runGitCommand(["init", "-b", "main"], { cwd: workspacePath });
    const refreshed = createFakeWorkspace(workspacePath);
    harness.setProvisionedWorkspace(refreshed.workspace);

    await dispatchCommand(
      {
        type: "workspace.commit",
        environmentId: "env-late-git",
        workspaceContext: { workspacePath },
        message: "Late git",
      },
      harness.dispatchOptions(),
    );

    expect(refreshed.state.lastCommitMessage).toBe("Late git");
    expect(harness.manager.get("env-late-git")?.workspace.isGitRepo).toBe(true);
  });

  it("rehydrates a missing workspace runtime from workspaceContext", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-rehydrate" });

    await dispatchCommand(
      {
        type: "workspace.commit",
        environmentId: "env-rehydrate",
        workspaceContext: { workspacePath: "/tmp/env-rehydrate" },
        message: "Rehydrated",
      },
      harness.dispatchOptions(),
    );

    expect(harness.workspaceState.lastCommitMessage).toBe("Rehydrated");
    expect(harness.provisions).toEqual([
      expect.objectContaining({
        path: "/tmp/env-rehydrate",
        signal: expect.any(AbortSignal),
      }),
    ]);
  });

  it("rejects commits for non-git workspaces", async () => {
    const harness = createHarness({ workspacePath: "/tmp/non-git-env" });
    harness.workspace.isGitRepo = false;
    await harness.manager.ensureEnvironment({
      environmentId: "env-non-git",
      workspacePath: "/tmp/non-git-env",
    });

    await expect(
      dispatchCommand(
        {
          type: "workspace.commit",
          environmentId: "env-non-git",
          workspaceContext: { workspacePath: "/tmp/non-git-env" },
          message: "Nope",
        },
        harness.dispatchOptions(),
      ),
    ).rejects.toMatchObject({ code: "not_git_repo" });
    expect(harness.workspaceState.lastCommitMessage).toBeUndefined();
  });

  it("covers host.list_files", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-list-files-");
    await fs.writeFile(path.join(tempDir, "notes.md"), "hello");
    await fs.mkdir(path.join(tempDir, "notes"));
    await fs.writeFile(path.join(tempDir, "notes", "todo.md"), "world");

    const harness = createHarness();
    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_files",
        followRootSymlink: false,
        path: tempDir,
        limit: 1000,
        includeHidden: false,
        respectGitIgnore: false,
        excludeNames: [],
      },
      harness.dispatchOptions(),
      new AbortController().signal,
    );

    const paths = result.files.map((file) => file.path).sort();
    expect(paths).toEqual(["notes.md", "notes/todo.md"]);
    expect(result.truncated).toBe(false);
  });

  it("covers host.list_paths with directories included", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-list-paths-");
    await fs.mkdir(path.join(tempDir, "notes", "daily"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "notes", "daily", "todo.md"),
      "world",
    );

    const harness = createHarness();
    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_paths",
        path: tempDir,
        limit: 1000,
        includeHidden: false,
        respectGitIgnore: false,
        excludeNames: [],
        includeFiles: true,
        includeDirectories: true,
      },
      harness.dispatchOptions(),
      new AbortController().signal,
    );

    expect(
      result.paths
        .map((pathEntry) => ({
          kind: pathEntry.kind,
          path: pathEntry.path,
          name: pathEntry.name,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    ).toEqual([
      { kind: "directory", path: "notes", name: "notes" },
      { kind: "directory", path: "notes/daily", name: "daily" },
      { kind: "file", path: "notes/daily/todo.md", name: "todo.md" },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("returns empty files for host.list_files when path does not exist", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-list-missing-");
    const missingPath = path.join(tempDir, "does-not-exist");

    const harness = createHarness();
    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_files",
        followRootSymlink: false,
        path: missingPath,
        limit: 1000,
        includeHidden: false,
        respectGitIgnore: false,
        excludeNames: [],
      },
      harness.dispatchOptions(),
      new AbortController().signal,
    );

    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns empty paths for host.list_paths when path does not exist", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-list-paths-missing-");
    const missingPath = path.join(tempDir, "does-not-exist");

    const harness = createHarness();
    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_paths",
        path: missingPath,
        limit: 1000,
        includeHidden: false,
        respectGitIgnore: false,
        excludeNames: [],
        includeFiles: true,
        includeDirectories: true,
      },
      harness.dispatchOptions(),
      new AbortController().signal,
    );

    expect(result.paths).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("rejects host.list_files when path itself is a symlink", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-list-symlink-root-");
    const targetRoot = path.join(tempDir, "target-root");
    const symlinkRoot = path.join(tempDir, "root-link");
    await fs.mkdir(targetRoot);
    await fs.writeFile(path.join(targetRoot, "notes.txt"), "hello");
    await fs.symlink(targetRoot, symlinkRoot);

    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.list_files",
          followRootSymlink: false,
          path: symlinkRoot,
          limit: 1000,
          includeHidden: false,
          respectGitIgnore: false,
          excludeNames: [],
        },
        harness.dispatchOptions(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "invalid_path",
      message: expect.stringContaining("must not be a symlink"),
    });
  });

  it("reads and lists a linked skill while confining files to its resolved root", async () => {
    const tempDir = await makeTempDir("bb-dispatch-linked-skill-");
    const skillRoot = path.join(tempDir, "shared", "research");
    const linkedRoot = path.join(tempDir, "research");
    await fs.mkdir(path.join(skillRoot, "references"), { recursive: true });
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), "# Research");
    await fs.writeFile(
      path.join(skillRoot, "references", "guide.md"),
      "# Guide",
    );
    await fs.writeFile(path.join(skillRoot, ".env"), "hidden");
    await fs.writeFile(path.join(tempDir, "outside.md"), "outside");
    await fs.symlink(skillRoot, linkedRoot, "dir");
    await fs.symlink(
      path.join(tempDir, "outside.md"),
      path.join(skillRoot, "escape.md"),
    );
    const harness = createHarness();
    const signal = new AbortController().signal;

    const files = await dispatchOnlineRpcCommand(
      {
        type: "host.list_files",
        followRootSymlink: true,
        path: linkedRoot,
        limit: 200,
        includeHidden: false,
        respectGitIgnore: false,
        excludeNames: [],
      },
      harness.dispatchOptions(),
      signal,
    );
    expect(files.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "references/guide.md",
    ]);

    const read = (relativePath: string) =>
      dispatchOnlineRpcCommand(
        {
          type: "host.read_file",
          path: path.join(linkedRoot, relativePath),
          rootPath: linkedRoot,
          followRootSymlink: true,
        },
        harness.dispatchOptions(),
        signal,
      );
    await expect(read("SKILL.md")).resolves.toMatchObject({
      content: "# Research",
    });
    await expect(read("references/guide.md")).resolves.toMatchObject({
      content: "# Guide",
    });
    await expect(read("escape.md")).rejects.toMatchObject({
      code: "invalid_path",
      message: expect.stringContaining("escapes read root"),
    });
    await expect(read("../outside.md")).rejects.toMatchObject({
      code: "invalid_path",
    });

    await fs.rm(skillRoot, { recursive: true });
    await expect(read("SKILL.md")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns base64 for image files", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-read-image-");
    const imagePath = path.join(tempDir, "preview.png");
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await fs.writeFile(imagePath, imageBytes);

    const harness = createHarness();
    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.read_file",
        followRootSymlink: false,
        path: imagePath,
        rootPath: tempDir,
      },
      harness.dispatchOptions(),
      new AbortController().signal,
    );

    expect(result.path).toBe(imagePath);
    expect("content" in result ? result.content : undefined).toBe(
      imageBytes.toString("base64"),
    );
    expect(result.contentEncoding).toBe("base64");
    expect(result.mimeType).toBe("image/png");
    expect(result.sizeBytes).toBe(imageBytes.length);
  });

  it("rejects host.read_file when the resolved path escapes rootPath through a symlink", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-read-root-escape-");
    const outsidePath = path.join(tempDir, "..", "outside.txt");
    const nestedDir = path.join(tempDir, "notes");
    const symlinkPath = path.join(nestedDir, "secrets");
    await fs.writeFile(outsidePath, "outside");
    await fs.mkdir(nestedDir);
    await fs.symlink(outsidePath, symlinkPath);

    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.read_file",
          followRootSymlink: false,
          path: symlinkPath,
          rootPath: tempDir,
        },
        harness.dispatchOptions(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "invalid_path",
      message: expect.stringContaining("escapes read root"),
    });
  });

  it("rejects host.read_file when rootPath itself is a symlink", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-read-root-symlink-");
    const targetRoot = path.join(tempDir, "target-root");
    const symlinkRoot = path.join(tempDir, "root-link");
    const filePath = path.join(symlinkRoot, "notes.txt");
    await fs.mkdir(targetRoot);
    await fs.writeFile(path.join(targetRoot, "notes.txt"), "hello");
    await fs.symlink(targetRoot, symlinkRoot);

    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.read_file",
          followRootSymlink: false,
          path: filePath,
          rootPath: symlinkRoot,
        },
        harness.dispatchOptions(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "invalid_path",
      message: expect.stringContaining("must not be a symlink"),
    });
  });

  it("enforces the 10 MB image read limit", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-read-large-image-");
    const imagePath = path.join(tempDir, "large.png");
    await fs.writeFile(imagePath, Buffer.alloc(10 * 1024 * 1024 + 1));

    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.read_file",
          followRootSymlink: false,
          path: imagePath,
          rootPath: tempDir,
        },
        harness.dispatchOptions(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "file_too_large",
      message: expect.stringContaining("10 MB"),
    });
  });

  it("enforces the 25 MB non-image read limit", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-read-large-file-");
    const filePath = path.join(tempDir, "large.bin");
    await fs.writeFile(filePath, Buffer.alloc(25 * 1024 * 1024 + 1));

    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.read_file",
          followRootSymlink: false,
          path: filePath,
          rootPath: tempDir,
        },
        harness.dispatchOptions(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "file_too_large",
      message: expect.stringContaining("25 MB"),
    });
  });

  it("treats svg files as utf8 text with the non-image size limit", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-read-svg-");
    const filePath = path.join(tempDir, "diagram.svg");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    await fs.writeFile(filePath, svg);

    const harness = createHarness();
    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.read_file",
        followRootSymlink: false,
        path: filePath,
        rootPath: tempDir,
      },
      harness.dispatchOptions(),
      new AbortController().signal,
    );

    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.contentEncoding).toBe("utf8");
    expect("content" in result ? result.content : undefined).toBe(svg);
  });

  it("falls back to base64 for declared text files whose bytes are not valid utf8", async () => {
    const tempDir = await makeTempDir("bb-dispatch-host-read-invalid-utf8-");
    const filePath = path.join(tempDir, "notes.txt");
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    await fs.writeFile(filePath, bytes);

    const harness = createHarness();
    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.read_file",
        followRootSymlink: false,
        path: filePath,
        rootPath: tempDir,
      },
      harness.dispatchOptions(),
      new AbortController().signal,
    );

    expect(result.mimeType).toBe("text/plain");
    expect(result.contentEncoding).toBe("base64");
    expect("content" in result ? result.content : undefined).toBe(
      bytes.toString("base64"),
    );
  });
});
