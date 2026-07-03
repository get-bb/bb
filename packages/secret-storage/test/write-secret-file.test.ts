import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteSecretFile, writeSecretFile } from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-write-secret-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

describe("writeSecretFile", () => {
  it("writes the value with 0600 mode, creating parent directories", async () => {
    const dir = await makeTempDir();
    const secretPath = path.join(dir, "plugins", "slack", "secrets", "token");

    await writeSecretFile(secretPath, "xoxb-123");

    expect(await readFile(secretPath, "utf8")).toBe("xoxb-123");
    expect((await stat(secretPath)).mode & 0o777).toBe(0o600);
  });

  it("overwrites an existing secret and leaves no temp files behind", async () => {
    const dir = await makeTempDir();
    const secretPath = path.join(dir, "token");

    await writeSecretFile(secretPath, "first");
    await writeSecretFile(secretPath, "second");

    expect(await readFile(secretPath, "utf8")).toBe("second");
    expect(await readdir(dir)).toEqual(["token"]);
  });
});

describe("deleteSecretFile", () => {
  it("removes an existing secret and tolerates missing files", async () => {
    const dir = await makeTempDir();
    const secretPath = path.join(dir, "token");
    await writeSecretFile(secretPath, "value");

    await deleteSecretFile(secretPath);
    await deleteSecretFile(secretPath);

    expect(await readdir(dir)).toEqual([]);
  });
});
