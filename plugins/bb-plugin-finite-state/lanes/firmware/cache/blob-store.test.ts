import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkNodeWithResult, putBlob } from "./blob-store.js";
import type { FirmwareMount, FirmwareNode } from "./manifest.js";

const fsMocks = vi.hoisted(() => ({
  actualLink: null as null | typeof import("node:fs/promises").link,
  link: vi.fn<typeof import("node:fs/promises").link>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fsMocks.actualLink = actual.link;
  fsMocks.link.mockImplementation(actual.link);
  return { ...actual, link: fsMocks.link };
});

async function createIgnoredWorktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-firmware-blob-test-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  return realpath(root);
}

async function createRootfs(root: string, pvId = "pv-1"): Promise<string> {
  const path = join(root, ".fs-firmware", pvId, "rootfs");
  await mkdir(path, { recursive: true });
  return path;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function mount(root: string, pvId: string): FirmwareMount {
  return {
    pvId,
    source: "standalone_unpack",
    rootfsPath: join(root, ".fs-firmware", pvId, "rootfs"),
    manifestPath: join(root, ".fs-firmware", pvId, "manifest.sqlite"),
    inputSha256: null,
    artifactHash: null,
    readiness: "partial",
    nodeCount: 1,
    hydratedCount: 1,
    errors: [],
  };
}

function node(path: string, hash: string): FirmwareNode {
  return {
    path,
    kind: "file",
    fileHash: hash,
    size: 7,
    mimeType: null,
    fullType: null,
    unixMode: 0o755,
    symlinkTarget: null,
    materialized: true,
    errors: [],
  };
}

function scope(root: string, projectVersionId: string) {
  return {
    worktreeRoot: root,
    projectId: "project-1",
    projectVersionId,
    generationId: "generation-1",
  };
}

describe("firmware blob store", () => {
  beforeEach(() => {
    fsMocks.link.mockReset();
    fsMocks.link.mockImplementation(fsMocks.actualLink!);
  });

  it("hashes a stream, atomically promotes it, and reuses valid bytes", async () => {
    const root = await createIgnoredWorktree();
    const hash = digest("payload");
    const first = await putBlob(root, Readable.from(["pay", "load"]), hash);
    expect(first.reused).toBe(false);
    expect(await readFile(first.path, "utf8")).toBe("payload");
    const second = await putBlob(root, Readable.from(["payload"]), hash);
    expect(second).toEqual({ path: first.path, reused: true });
    await rm(root, { recursive: true, force: true });
  });

  it("rejects a wrong expected hash without exposing corrupt bytes", async () => {
    const root = await createIgnoredWorktree();
    const expected = digest("expected");
    await expect(putBlob(root, Readable.from(["wrong"]), expected)).rejects.toMatchObject({
      code: "BLOB_HASH_MISMATCH",
    });
    await expect(lstat(join(root, ".fs-firmware", "blobs", expected))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(join(root, ".fs-firmware", "staging", "blobs"))).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it("cleans staging after an interrupted stream", async () => {
    const root = await createIgnoredWorktree();
    const interrupted = new Readable({
      read() {
        this.push("partial");
        this.destroy(new Error("interrupted"));
      },
    });
    await expect(putBlob(root, interrupted, digest("partial"))).rejects.toThrow("interrupted");
    expect(await readdir(join(root, ".fs-firmware", "staging", "blobs"))).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it("hardlinks one canonical blob into two version roots", async () => {
    const root = await createIgnoredWorktree();
    await createRootfs(root, "pv-1");
    await createRootfs(root, "pv-2");
    const hash = digest("payload");
    const blob = await putBlob(root, Readable.from(["payload"]), hash);
    const first = await linkNodeWithResult(
      scope(root, "pv-1"),
      mount(root, "pv-1"),
      node("/bin/tool", hash),
      blob.path,
    );
    const second = await linkNodeWithResult(
      scope(root, "pv-2"),
      mount(root, "pv-2"),
      node("/bin/tool", hash),
      blob.path,
    );
    const blobStat = await lstat(blob.path);
    const firstStat = await lstat(join(root, ".fs-firmware", "pv-1", "rootfs", "bin", "tool"));
    const secondStat = await lstat(join(root, ".fs-firmware", "pv-2", "rootfs", "bin", "tool"));
    expect(first).toEqual({ method: "hardlink", deduplicated: true });
    expect(second).toEqual({ method: "hardlink", deduplicated: true });
    expect(firstStat.ino).toBe(blobStat.ino);
    expect(secondStat.ino).toBe(blobStat.ino);
    await rm(root, { recursive: true, force: true });
  });

  it("surfaces a verified-copy fallback when the blob cannot be hardlinked", async () => {
    const root = await createIgnoredWorktree();
    await createRootfs(root);
    const hash = digest("payload");
    const blob = await putBlob(root, Readable.from(["payload"]), hash);
    fsMocks.link.mockRejectedValueOnce(Object.assign(new Error("cross-device"), { code: "EXDEV" }));

    const result = await linkNodeWithResult(
      scope(root, "pv-1"),
      mount(root, "pv-1"),
      node("/bin/tool", hash),
      blob.path,
    );
    const destination = join(root, ".fs-firmware", "pv-1", "rootfs", "bin", "tool");
    expect(result).toEqual({ method: "verified_copy", deduplicated: false });
    expect(await readFile(destination, "utf8")).toBe("payload");
    expect((await lstat(destination)).ino).not.toBe((await lstat(blob.path)).ino);
    await rm(root, { recursive: true, force: true });
  });

  it("verifies the direct-copy promotion when temporary hardlinks are unsupported", async () => {
    const root = await createIgnoredWorktree();
    await createRootfs(root);
    const hash = digest("payload");
    const blob = await putBlob(root, Readable.from(["payload"]), hash);
    fsMocks.link
      .mockRejectedValueOnce(Object.assign(new Error("cross-device"), { code: "EXDEV" }))
      .mockRejectedValueOnce(Object.assign(new Error("unsupported"), { code: "ENOTSUP" }));

    const result = await linkNodeWithResult(
      scope(root, "pv-1"),
      mount(root, "pv-1"),
      node("/bin/tool", hash),
      blob.path,
    );
    expect(result).toEqual({ method: "verified_copy", deduplicated: false });
    expect(await readFile(join(root, ".fs-firmware", "pv-1", "rootfs", "bin", "tool"), "utf8")).toBe(
      "payload",
    );
    await rm(root, { recursive: true, force: true });
  });

  it("revalidates the SDK-derived worktree scope and ignore immediately before writing rootfs", async () => {
    const root = await createIgnoredWorktree();
    await createRootfs(root);
    const hash = digest("payload");
    const blob = await putBlob(root, Readable.from(["payload"]), hash);
    await writeFile(join(root, ".gitignore"), "", "utf8");

    await expect(
      linkNodeWithResult(
        scope(root, "pv-1"),
        mount(root, "pv-1"),
        node("/bin/tool", hash),
        blob.path,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_CACHE_NOT_IGNORED" });
    await expect(lstat(join(root, ".fs-firmware", "pv-1", "rootfs", "bin", "tool"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a mount assembled outside the explicitly supplied worktree scope", async () => {
    const root = await createIgnoredWorktree();
    const otherRoot = await createIgnoredWorktree();
    await createRootfs(root);
    const hash = digest("payload");
    const blob = await putBlob(root, Readable.from(["payload"]), hash);

    await expect(
      linkNodeWithResult(
        scope(otherRoot, "pv-1"),
        mount(root, "pv-1"),
        node("/bin/tool", hash),
        blob.path,
      ),
    ).rejects.toMatchObject({ code: "MOUNT_INVALID" });
    await expect(lstat(join(root, ".fs-firmware", "pv-1", "rootfs", "bin", "tool"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  });

  it("creates only representable firmware symlinks", async () => {
    const root = await createIgnoredWorktree();
    await createRootfs(root);
    await mkdir(join(root, ".fs-firmware", "pv-1", "rootfs", "lib"));
    const symlinkNode: FirmwareNode = {
      ...node("/bin/tool", digest("unused")),
      kind: "symlink",
      fileHash: null,
      size: null,
      materialized: false,
      symlinkTarget: "/lib/tool",
    };
    await linkNodeWithResult(scope(root, "pv-1"), mount(root, "pv-1"), symlinkNode, "");
    expect(await readlink(join(root, ".fs-firmware", "pv-1", "rootfs", "bin", "tool"))).toBe(
      "../lib/tool",
    );
    await expect(
      linkNodeWithResult(
        scope(root, "pv-1"),
        mount(root, "pv-1"),
        { ...symlinkNode, path: "/bin/bad", symlinkTarget: "../../../outside" },
        "",
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_FIRMWARE_SYMLINK" });
    await rm(root, { recursive: true, force: true });
  });
});
