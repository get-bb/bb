import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeTree } from "./remove-tree.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.chmod(root, 0o700).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("removeTree", () => {
  it("removes trees containing read-only directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "remove-tree-"));
    roots.push(root);
    const trash = path.join(root, ".bb-trash-thr_a-1");
    const locked = path.join(trash, "project", "locked-dir");
    await fs.mkdir(locked, { recursive: true });
    await fs.writeFile(path.join(locked, "note.md"), "x");
    await fs.chmod(path.join(locked, "note.md"), 0o444);
    await fs.chmod(locked, 0o555);

    await removeTree(trash);

    await expect(fs.lstat(trash)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not change permissions outside the tree through symbolic links", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "remove-tree-"));
    roots.push(root);
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.chmod(outside, 0o555);
    const trash = path.join(root, "trash");
    const locked = path.join(trash, "locked");
    await fs.mkdir(locked, { recursive: true });
    await fs.symlink(outside, path.join(locked, "link"));
    await fs.chmod(locked, 0o555);

    await removeTree(trash);

    await expect(fs.lstat(trash)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.stat(outside)).mode & 0o777).toBe(0o555);
    await fs.chmod(outside, 0o700);
  });
});
