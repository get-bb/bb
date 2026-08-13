import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { computeForgeArtifactHash } from "./artifact-hash.js";

const roots: string[] = [];

async function rootfs(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-forge-hash-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Forge artifact hashing", () => {
  it("matches the Forge 5083a9d7 golden tree byte-for-byte", async () => {
    const root = await rootfs();
    await mkdir(join(root, "a"));
    await writeFile(join(root, "z-last"), "omega");
    await writeFile(join(root, "a", "empty"), Buffer.alloc(0));
    await writeFile(join(root, "a", "β.bin"), Buffer.from([0, 255, 16]));
    await writeFile(join(root, "middle"), "middle\n");
    await symlink("../middle", join(root, "a", "link-to-middle"));
    await symlink("a", join(root, "linked-dir"), "dir");

    const result = await computeForgeArtifactHash(root);

    // Produced by qemu_dynamic.py::_firmware_artifact_hash at pinned Forge
    // commit 5083a9d745e6d0e22166d2850e7e43fc3987c350.
    expect(result.artifactHash).toBe("8029af87eb0267644825b89f5ebffee1d2e400c6f58c4febd56584e35afad597");
    expect(result.fileCount).toBe(5);
    expect(result.regularFileHashes["/a/empty"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(result.regularFileHashes).not.toHaveProperty("/a/link-to-middle");
    expect(result.regularFileHashes).not.toHaveProperty("/linked-dir");
  });

  it("changes for file mutation and preserves path ordering", async () => {
    const root = await rootfs();
    await writeFile(join(root, "b"), "same");
    await writeFile(join(root, "a"), "same");
    const before = await computeForgeArtifactHash(root);

    await writeFile(join(root, "b"), "changed");
    const after = await computeForgeArtifactHash(root);

    expect(after.artifactHash).not.toBe(before.artifactHash);
  });

  it("never follows a symlink that escapes rootfs", async () => {
    const root = await rootfs();
    const outside = await rootfs();
    await writeFile(join(outside, "secret"), "outside bytes");
    await symlink(join(outside, "secret"), join(root, "escape"));

    await expect(computeForgeArtifactHash(root)).rejects.toMatchObject({
      code: "UNSAFE_FIRMWARE_SYMLINK",
    });
  });

  it("fails closed when a regular file cannot be read", async () => {
    const root = await rootfs();
    const unreadable = join(root, "unreadable");
    await writeFile(unreadable, "bytes");
    await chmod(unreadable, 0o000);
    try {
      await expect(computeForgeArtifactHash(root)).rejects.toMatchObject({
        code: "FIRMWARE_FILE_UNREADABLE",
      });
    } finally {
      await chmod(unreadable, 0o600);
    }
  });
});
