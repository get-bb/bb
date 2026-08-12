import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePackagedAppBinary } from "../scripts/packaged-app-binary.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("resolvePackagedAppBinary", () => {
  it("locates bb.exe under win-unpacked", async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), "bb-desktop-release-"));
    tempDirs.push(releaseDir);
    const unpackedDir = join(releaseDir, "win-unpacked");
    await mkdir(unpackedDir, { recursive: true });
    const exePath = join(unpackedDir, "bb.exe");
    await writeFile(exePath, "fake");

    await expect(
      resolvePackagedAppBinary({
        applicationName: "bb",
        platform: "win32",
        releaseDir,
      }),
    ).resolves.toBe(exePath);
  });

  it("prefers win-unpacked over win-arm64-unpacked on x64", async () => {
    const releaseDir = await mkdtemp(join(tmpdir(), "bb-desktop-release-"));
    tempDirs.push(releaseDir);
    const x64Dir = join(releaseDir, "win-unpacked");
    const armDir = join(releaseDir, "win-arm64-unpacked");
    await mkdir(x64Dir, { recursive: true });
    await mkdir(armDir, { recursive: true });
    const x64Exe = join(x64Dir, "bb.exe");
    const armExe = join(armDir, "bb.exe");
    await writeFile(x64Exe, "x64");
    await writeFile(armExe, "arm64");

    await expect(
      resolvePackagedAppBinary({
        applicationName: "bb",
        arch: "x64",
        platform: "win32",
        releaseDir,
      }),
    ).resolves.toBe(x64Exe);
  });
});
