import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { computeForgeArtifactHash } from "./artifact-hash.js";

const roots: string[] = [];

// Copied from _firmware_artifact_hash in the authoritative upstream source:
// https://github.com/FiniteStateInc/finite-state-forge/blob/5083a9d745e6d0e22166d2850e7e43fc3987c350/src/finite_state_forge/tools/qemu_dynamic.py#L476-L505
// Git blob: 99cf948f731547cd07eae05256b3386550ec7220. The executable hash
// statements are transcribed unchanged; the test wrapper supplies imports,
// argv, and result printing.
const PINNED_FORGE_HASH_SOURCE = String.raw`
import hashlib
import sys
from pathlib import Path

def _firmware_artifact_hash(firmware_root: Path) -> str:
    if not firmware_root.is_dir():
        return ""
    h = hashlib.sha256()
    for f in sorted(firmware_root.rglob("*")):
        if f.is_file():
            h.update(str(f.relative_to(firmware_root)).encode())
            h.update(b"\0")
            try:
                h.update(hashlib.sha256(f.read_bytes()).digest())
            except OSError:
                h.update(b"<unreadable>\0")
    return h.hexdigest()

print(_firmware_artifact_hash(Path(sys.argv[1])))
`;

function pinnedForgeArtifactHash(root: string): string {
  return execFileSync("python3", ["-c", PINNED_FORGE_HASH_SOURCE, root], {
    encoding: "utf8",
  }).trim();
}

async function rootfs(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-forge-hash-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Forge artifact hashing", () => {
  it("matches the pinned upstream Forge source excerpt byte-for-byte", async () => {
    const root = await rootfs();
    await mkdir(join(root, "a"));
    await writeFile(join(root, "z-last"), "omega");
    await writeFile(join(root, "a", "empty"), Buffer.alloc(0));
    await writeFile(join(root, "a", "β.bin"), Buffer.from([0, 255, 16]));
    await writeFile(join(root, "middle"), "middle\n");
    await symlink("../middle", join(root, "a", "link-to-middle"));
    await symlink("a", join(root, "linked-dir"), "dir");

    const result = await computeForgeArtifactHash(root);

    expect(result.artifactHash).toBe(pinnedForgeArtifactHash(root));
    expect(result.fileCount).toBe(5);
    expect(result.regularFileHashes["/a/empty"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(result.regularFileHashes).not.toHaveProperty("/a/link-to-middle");
    expect(result.regularFileHashes).not.toHaveProperty("/linked-dir");
    expect(result.symlinkTargets).toEqual({
      "/a/link-to-middle": "../middle",
      "/linked-dir": "a",
    });
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

  it("fails closed when the tree contains a special filesystem node", async () => {
    const root = await rootfs();
    execFileSync("mkfifo", [join(root, "device-stream")]);

    await expect(computeForgeArtifactHash(root)).rejects.toMatchObject({
      code: "UNSUPPORTED_FIRMWARE_NODE",
    });
  });
});
