import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { replaceFile } from "../src/index.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("replaceFile", () => {
  it("leaves the original file intact when a write fails midway", async () => {
    const dir = await makeTempDir("bb-replace-file-");
    const target = path.join(dir, "note.md");
    await fs.writeFile(target, "original");
    const diskFull = Object.assign(new Error("no space left on device"), {
      code: "ENOSPC",
    });
    const probe = await fs.open(target, "r");
    const fileHandlePrototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalWriteFile = fs.writeFile;
    const originalHandleWrite = fileHandlePrototype.write;
    vi.spyOn(fs, "writeFile").mockImplementation(async (file, data) => {
      await originalWriteFile(file, String(data).slice(0, 3));
      throw diskFull;
    });
    vi.spyOn(fileHandlePrototype, "write").mockImplementation(async function (
      this: unknown,
      data: unknown,
    ) {
      await originalHandleWrite.call(this, data, 0, 3);
      throw diskFull;
    });

    try {
      await expect(
        replaceFile({ contents: Buffer.from("replacement"), path: target }),
      ).rejects.toBe(diskFull);
    } finally {
      vi.restoreAllMocks();
    }

    await expect(fs.readFile(target, "utf8")).resolves.toBe("original");
    await expect(fs.readdir(dir)).resolves.toEqual(["note.md"]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "overwrites in place without a precondition when the parent directory is not writable",
    async () => {
      const dir = await makeTempDir("bb-replace-file-");
      const lockedDir = path.join(dir, "locked");
      await fs.mkdir(lockedDir);
      const target = path.join(lockedDir, "note.md");
      await fs.writeFile(target, "original");
      await fs.chmod(lockedDir, 0o555);

      try {
        await expect(
          replaceFile({ contents: Buffer.from("replacement"), path: target }),
        ).resolves.toEqual({
          outcome: "written",
          sha256: sha256("replacement"),
          sizeBytes: 11,
        });
      } finally {
        await fs.chmod(lockedDir, 0o755);
      }

      await expect(fs.readFile(target, "utf8")).resolves.toBe("replacement");
      await expect(fs.readdir(lockedDir)).resolves.toEqual(["note.md"]);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses a revision-checked save rather than overwrite in place in a read-only directory",
    async () => {
      const dir = await makeTempDir("bb-replace-file-");
      const lockedDir = path.join(dir, "locked");
      await fs.mkdir(lockedDir);
      const target = path.join(lockedDir, "note.md");
      await fs.writeFile(target, "original");
      await fs.chmod(lockedDir, 0o555);

      try {
        await expect(
          replaceFile({
            contents: Buffer.from("replacement"),
            expectedSha256: sha256("original"),
            path: target,
          }),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await fs.chmod(lockedDir, 0o755);
      }

      await expect(fs.readFile(target, "utf8")).resolves.toBe("original");
    },
  );

  it.skipIf(process.platform === "win32")(
    "applies the process umask to a requested mode on new files",
    async () => {
      const dir = await makeTempDir("bb-replace-file-");
      const target = path.join(dir, "shared.txt");
      const umask = process.umask();

      await replaceFile({
        contents: Buffer.from("hello"),
        mode: 0o666,
        path: target,
      });

      expect((await fs.stat(target)).mode & 0o777).toBe(0o666 & ~umask);
    },
  );

  it("saves files whose names are close to the filesystem limit", async () => {
    const dir = await makeTempDir("bb-replace-file-");
    const target = path.join(dir, `${"n".repeat(240)}.md`);
    await fs.writeFile(target, "original");

    await expect(
      replaceFile({ contents: Buffer.from("replacement"), path: target }),
    ).resolves.toMatchObject({ outcome: "written" });
    await expect(fs.readdir(dir)).resolves.toEqual([path.basename(target)]);
  });
});
