import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommandDispatchError,
  type CommandOf,
  isExpectedCommandDispatchError,
} from "../command-dispatch-support.js";
import { writeHostFile } from "./file-write.js";
import { readHostFile } from "./host-files.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function writeCommand(
  overrides: Partial<CommandOf<"host.write_file">> &
    Pick<CommandOf<"host.write_file">, "path">,
): CommandOf<"host.write_file"> {
  return {
    type: "host.write_file",
    content: "hello",
    contentEncoding: "utf8",
    createParents: false,
    ...overrides,
  };
}

async function captureWriteError(
  command: CommandOf<"host.write_file">,
): Promise<unknown> {
  try {
    await writeHostFile(command);
  } catch (error) {
    return error;
  }
  throw new Error("Expected writeHostFile to fail");
}

describe("writeHostFile", () => {
  it("writes a new file unconditionally and returns its hash", async () => {
    const dir = await makeTempDir("bb-file-write-");
    const target = path.join(dir, "note.md");

    const result = await writeHostFile(
      writeCommand({ path: target, content: "# Hello" }),
    );

    expect(result).toEqual({
      outcome: "written",
      sha256: sha256("# Hello"),
      sizeBytes: 7,
    });
    await expect(fs.readFile(target, "utf8")).resolves.toBe("# Hello");
  });

  it("overwrites an existing file when the expected hash matches", async () => {
    const dir = await makeTempDir("bb-file-write-");
    const target = path.join(dir, "note.md");
    await fs.writeFile(target, "old");

    const result = await writeHostFile(
      writeCommand({
        path: target,
        content: "new",
        expectedSha256: sha256("old"),
      }),
    );

    expect(result).toEqual({
      outcome: "written",
      sha256: sha256("new"),
      sizeBytes: 3,
    });
    await expect(fs.readFile(target, "utf8")).resolves.toBe("new");
  });

  it("returns a conflict with the current hash when the expected hash is stale", async () => {
    const dir = await makeTempDir("bb-file-write-");
    const target = path.join(dir, "note.md");
    await fs.writeFile(target, "current");

    const result = await writeHostFile(
      writeCommand({
        path: target,
        content: "mine",
        expectedSha256: sha256("stale"),
      }),
    );

    expect(result).toEqual({
      outcome: "conflict",
      currentSha256: sha256("current"),
    });
    await expect(fs.readFile(target, "utf8")).resolves.toBe("current");
  });

  it("returns a null-hash conflict when the expected file is missing", async () => {
    const dir = await makeTempDir("bb-file-write-");

    const result = await writeHostFile(
      writeCommand({
        path: path.join(dir, "gone.md"),
        expectedSha256: sha256("anything"),
      }),
    );

    expect(result).toEqual({ outcome: "conflict", currentSha256: null });
  });

  it("treats expectedSha256 null as create-only", async () => {
    const dir = await makeTempDir("bb-file-write-");
    const target = path.join(dir, "note.md");

    const created = await writeHostFile(
      writeCommand({ path: target, expectedSha256: null }),
    );
    expect(created).toMatchObject({ outcome: "written" });

    const conflicted = await writeHostFile(
      writeCommand({ path: target, expectedSha256: null }),
    );
    expect(conflicted).toEqual({
      outcome: "conflict",
      currentSha256: sha256("hello"),
    });
  });

  it("decodes base64 content", async () => {
    const dir = await makeTempDir("bb-file-write-");
    const target = path.join(dir, "logo.bin");

    const result = await writeHostFile(
      writeCommand({
        path: target,
        content: Buffer.from([0, 1, 2, 255]).toString("base64"),
        contentEncoding: "base64",
      }),
    );

    expect(result).toMatchObject({ outcome: "written", sizeBytes: 4 });
    expect(Uint8Array.from(await fs.readFile(target))).toEqual(
      Uint8Array.from([0, 1, 2, 255]),
    );
  });

  it("fails with ENOENT when the parent is missing and createParents is false", async () => {
    const dir = await makeTempDir("bb-file-write-");

    const error = await captureWriteError(
      writeCommand({ path: path.join(dir, "nested", "note.md") }),
    );

    expect(isExpectedCommandDispatchError(error)).toBe(true);
    expect((error as CommandDispatchError).code).toBe("ENOENT");
  });

  it("creates missing parents when createParents is true", async () => {
    const dir = await makeTempDir("bb-file-write-");
    const target = path.join(dir, "a", "b", "note.md");

    const result = await writeHostFile(
      writeCommand({ path: target, createParents: true }),
    );

    expect(result).toMatchObject({ outcome: "written" });
    await expect(fs.readFile(target, "utf8")).resolves.toBe("hello");
  });

  it("rejects writes that escape the declared root via symlinks", async () => {
    const rootDir = await makeTempDir("bb-file-write-root-");
    const outsideDir = await makeTempDir("bb-file-write-outside-");
    await fs.symlink(outsideDir, path.join(rootDir, "link"), "dir");

    const error = await captureWriteError(
      writeCommand({
        path: path.join(rootDir, "link", "escape.md"),
        rootPath: rootDir,
      }),
    );

    expect(error).toBeInstanceOf(CommandDispatchError);
    expect((error as CommandDispatchError).code).toBe("invalid_path");
    await expect(
      fs.readFile(path.join(outsideDir, "escape.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects lexical escapes from the declared root", async () => {
    const rootDir = await makeTempDir("bb-file-write-root-");
    const outsideDir = await makeTempDir("bb-file-write-outside-");

    const error = await captureWriteError(
      writeCommand({
        path: path.join(outsideDir, "escape.md"),
        rootPath: rootDir,
      }),
    );

    expect(error).toBeInstanceOf(CommandDispatchError);
    expect((error as CommandDispatchError).code).toBe("invalid_path");
  });

  it("allows contained writes under the declared root", async () => {
    const rootDir = await makeTempDir("bb-file-write-root-");

    const result = await writeHostFile(
      writeCommand({
        path: path.join(rootDir, "notes", "note.md"),
        rootPath: rootDir,
        createParents: true,
      }),
    );

    expect(result).toMatchObject({ outcome: "written" });
  });

  it("rejects directory targets", async () => {
    const dir = await makeTempDir("bb-file-write-");

    const error = await captureWriteError(writeCommand({ path: dir }));

    expect(error).toBeInstanceOf(CommandDispatchError);
    expect((error as CommandDispatchError).code).toBe("invalid_path");
  });

  it("rejects relative paths", async () => {
    const error = await captureWriteError(
      writeCommand({ path: "relative/note.md" }),
    );

    expect(error).toBeInstanceOf(CommandDispatchError);
    expect((error as CommandDispatchError).code).toBe("invalid_path");
  });

  it("round-trips with readHostFile for compare-and-swap saves", async () => {
    const dir = await makeTempDir("bb-file-write-");
    const target = path.join(dir, "note.md");
    await fs.writeFile(target, "v1");

    const read = await readHostFile({ type: "host.read_file", path: target });
    const result = await writeHostFile(
      writeCommand({
        path: target,
        content: "v2",
        expectedSha256: read.sha256,
      }),
    );

    expect(result).toMatchObject({ outcome: "written" });
    const reread = await readHostFile({ type: "host.read_file", path: target });
    expect(reread.content).toBe("v2");
    expect(reread.sha256).toBe(sha256("v2"));
  });
});
