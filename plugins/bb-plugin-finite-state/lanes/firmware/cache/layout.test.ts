import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFirmwareCacheIgnored,
  manifestPath,
  mountRoot,
  rootfsPath,
  validatePvId,
} from "./layout.js";

async function createWorktree(ignored: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-firmware-layout-test-"));
  execFileSync("git", ["init", "--quiet", root]);
  if (ignored) await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  return root;
}

describe("firmware cache layout", () => {
  it("builds the canonical per-version paths", async () => {
    const root = await createWorktree(true);
    expect(mountRoot(root, "pv-1")).toBe(join(root, ".fs-firmware", "pv-1"));
    expect(rootfsPath(root, "pv-1")).toBe(join(root, ".fs-firmware", "pv-1", "rootfs"));
    expect(manifestPath(root, "pv-1")).toBe(join(root, ".fs-firmware", "pv-1", "manifest.sqlite"));
    await rm(root, { recursive: true, force: true });
  });

  it.each(["", ".", "..", "../pv", "/tmp/pv", "pv/a", "pv\\a", " pv"])(
    "rejects unsafe project-version id %s",
    (pvId) => expect(() => validatePvId(pvId)).toThrow(),
  );

  it("fails before writing when the cache is not ignored", async () => {
    const root = await createWorktree(false);
    expect(() => assertFirmwareCacheIgnored(root)).toThrowError(/must be ignored/iu);
    await expect(access(join(root, ".fs-firmware"))).rejects.toMatchObject({ code: "ENOENT" });
    await rm(root, { recursive: true, force: true });
  });
});
