import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeVirtualPath, resolveSafeNodePath, safeSymlinkTarget } from "./path-safety.js";

async function createIgnoredWorktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-firmware-path-test-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  return root;
}

async function createRootfs(root: string): Promise<string> {
  const path = join(root, ".fs-firmware", "pv-1", "rootfs");
  await mkdir(path, { recursive: true });
  return path;
}

describe("firmware path safety", () => {
  it.each(["../escape", "/a/../escape", "/a\0b", "C:\\host\\file", "//server/share", "/a\\b"])(
    "rejects unsafe path %s",
    (path) => {
      expect(() => normalizeVirtualPath(path)).toThrow();
    },
  );

  it("normalizes safe absolute virtual paths", () => {
    expect(normalizeVirtualPath("etc/config")).toBe("/etc/config");
    expect(normalizeVirtualPath("/etc/config")).toBe("/etc/config");
  });

  it("rejects Unicode normalization collisions", async () => {
    const root = await createIgnoredWorktree();
    const rootfs = await createRootfs(root);
    await writeFile(join(rootfs, "e\u0301"), "existing");
    await expect(resolveSafeNodePath(rootfs, "/é")).rejects.toMatchObject({
      code: "FIRMWARE_PATH_NORMALIZATION_COLLISION",
    });
    await rm(root, { recursive: true, force: true });
  });

  it("refuses to traverse a symlink parent", async () => {
    const root = await createIgnoredWorktree();
    const rootfs = await createRootfs(root);
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(rootfs, "link"));
    await expect(resolveSafeNodePath(rootfs, "/link/pwn", true)).rejects.toMatchObject({
      code: "FIRMWARE_SYMLINK_PARENT",
    });
    await rm(root, { recursive: true, force: true });
  });

  it("preserves safe relative symlinks and rewrites virtual-absolute targets", () => {
    expect(safeSymlinkTarget("/usr/bin/tool", "../lib/tool")).toBe("../lib/tool");
    expect(safeSymlinkTarget("/usr/bin/tool", "/lib/tool")).toBe("../../lib/tool");
    expect(safeSymlinkTarget("/usr/bin/tool", "/")).toBe("../..");
    expect(safeSymlinkTarget("/usr/bin/tool", "../..")).toBe("../..");
    expect(() => safeSymlinkTarget("/usr/bin/tool", "../../../host")).toThrow();
  });
});
