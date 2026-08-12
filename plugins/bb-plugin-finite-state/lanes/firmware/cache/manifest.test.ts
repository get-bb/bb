import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { linkNode, putBlob } from "./blob-store.js";
import {
  getMountReadiness,
  openManifest,
  type FirmwareManifestMeta,
  type FirmwareMount,
  type FirmwareNode,
  type FirmwarePageMeta,
  verifyMountIntegrity,
} from "./manifest.js";

async function createIgnoredWorktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-firmware-manifest-test-"));
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n", "utf8");
  return root;
}

function fileNode(path: string, materialized = false): FirmwareNode {
  return {
    path,
    kind: "file",
    fileHash: "a".repeat(64),
    size: 4,
    mimeType: "application/octet-stream",
    fullType: null,
    unixMode: 0o644,
    symlinkTarget: null,
    materialized,
    errors: [],
  };
}

function verifiedFileNode(path: string, bytes: string): FirmwareNode {
  return {
    ...fileNode(path, true),
    fileHash: createHash("sha256").update(bytes).digest("hex"),
    size: Buffer.byteLength(bytes),
  };
}

function manifestMeta(overrides: Partial<FirmwareManifestMeta> = {}): FirmwareManifestMeta {
  return {
    pvId: "pv-1",
    scanId: null,
    inputSha256: null,
    source: "api",
    artifactHash: null,
    fullyMaterialized: false,
    materializedAt: null,
    nodeCount: 0,
    hydratedCount: 0,
    adminBytesOk: null,
    unpackErrors: [],
    stale: false,
    ...overrides,
  };
}

function pageMeta(overrides: Partial<FirmwarePageMeta> = {}): FirmwarePageMeta {
  const { nodeCount: _nodeCount, hydratedCount: _hydratedCount, ...meta } = manifestMeta();
  return { ...meta, ...overrides };
}

describe("firmware manifest", () => {
  it("creates and idempotently migrates a real SQLite sidecar", async () => {
    const root = await createIgnoredWorktree();
    const first = openManifest(root, "pv-1");
    expect(first.invalidReason).toBeNull();
    expect(first.database.prepare("SELECT name FROM sqlite_master WHERE name = 'fs_node'").get()).toBeTruthy();
    first.close();
    const second = openManifest(root, "pv-1");
    expect(second.database.prepare("SELECT COUNT(*) AS count FROM _fs_migrations").get()).toEqual({ count: 2 });
    second.close();
    await rm(root, { recursive: true, force: true });
  });

  it("rolls back a failed batch without disturbing prior valid state", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    manifest.upsertNodes([fileNode("/kept")]);
    manifest.database.exec(`CREATE TRIGGER fail_bad_node BEFORE INSERT ON fs_node
      WHEN NEW.path = '/bad' BEGIN SELECT RAISE(ABORT, 'injected batch failure'); END`);
    expect(() => manifest.upsertNodes([fileNode("/new"), fileNode("/bad")])).toThrow(
      /injected batch failure/iu,
    );
    expect(manifest.listNodes().map((node) => node.path)).toEqual(["/kept"]);
    manifest.close();
    await rm(root, { recursive: true, force: true });
  });

  it("commits each ingestion page with matching counts and rolls back a failed page atomically", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    manifest.ingestPage([fileNode("/a")], pageMeta());
    expect(getMountReadiness(manifest)).toBe("metadata_only");

    manifest.database.exec(`CREATE TRIGGER fail_bad_page BEFORE INSERT ON fs_node
      WHEN NEW.path = '/bad' BEGIN SELECT RAISE(ABORT, 'injected page failure'); END`);
    expect(() =>
      manifest.ingestPage(
        [fileNode("/b"), fileNode("/bad")],
        pageMeta(),
      ),
    ).toThrow(/injected page failure/iu);
    expect(manifest.readMeta()).toMatchObject({ nodeCount: 1, hydratedCount: 0 });
    expect(manifest.listNodes().map((node) => node.path)).toEqual(["/a"]);
    expect(getMountReadiness(manifest)).toBe("metadata_only");

    manifest.database.exec("DROP TRIGGER fail_bad_page");
    manifest.ingestPage([fileNode("/b")], pageMeta());
    expect(manifest.listNodes().map((node) => node.path)).toEqual(["/a", "/b"]);
    expect(getMountReadiness(manifest)).toBe("metadata_only");
    manifest.close();
    await rm(root, { recursive: true, force: true });
  });

  it("quarantines attacker-controlled paths as per-node errors without aborting a coherent batch", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    manifest.ingestPage(
      [fileNode("/safe"), fileNode("../../escape", true), fileNode("/bad\\name", true)],
      pageMeta(),
    );
    const nodes = manifest.listNodes();
    expect(nodes).toHaveLength(3);
    expect(nodes.find((node) => node.path === "/safe")).toBeTruthy();
    const quarantined = nodes.filter((node) => node.path.startsWith("/.__fs_invalid__/"));
    expect(quarantined).toHaveLength(2);
    expect(quarantined.every((node) => node.errors.some((error) => error.includes("UNSAFE_FIRMWARE_PATH")))).toBe(
      true,
    );
    expect(manifest.readMeta()).toMatchObject({ nodeCount: 3, hydratedCount: 0 });
    expect(getMountReadiness(manifest)).toBe("metadata_only");
    manifest.close();
    await rm(root, { recursive: true, force: true });
  });

  it("computes readiness without counting placeholders as hydrated", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    expect(getMountReadiness(manifest)).toBe("missing");

    manifest.replaceNodes([fileNode("/a")], manifestMeta({ nodeCount: 1 }));
    expect(getMountReadiness(manifest)).toBe("metadata_only");

    const rootfs = join(root, ".fs-firmware", "pv-1", "rootfs");
    await mkdir(rootfs, { recursive: true });
    await writeFile(join(rootfs, "a"), "aaaa");
    manifest.replaceNodes(
      [verifiedFileNode("/a", "aaaa"), fileNode("/b")],
      manifestMeta({ nodeCount: 2, hydratedCount: 1 }),
    );
    expect(getMountReadiness(manifest)).toBe("partial");

    manifest.replaceNodes(
      [verifiedFileNode("/a", "aaaa")],
      manifestMeta({
        nodeCount: 1,
        hydratedCount: 1,
        fullyMaterialized: true,
        materializedAt: new Date(0).toISOString(),
      }),
    );
    expect(getMountReadiness(manifest)).toBe("partial");
    expect(verifyMountIntegrity(manifest)).toEqual({ verifiedFiles: 1 });
    expect(getMountReadiness(manifest)).toBe("fully_materialized");
    await rm(join(rootfs, "a"));
    expect(getMountReadiness(manifest)).toBe("invalid");
    await writeFile(join(rootfs, "a"), "aaaa");
    manifest.writeMeta(manifestMeta({ nodeCount: 1, hydratedCount: 1, stale: true }));
    expect(getMountReadiness(manifest)).toBe("stale");
    manifest.close();
    await rm(root, { recursive: true, force: true });
  });

  it("makes node and unpack errors prevent fully-materialized readiness", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    const rootfs = join(root, ".fs-firmware", "pv-1", "rootfs");
    await mkdir(rootfs, { recursive: true });
    await writeFile(join(rootfs, "a"), "aaaa");
    manifest.replaceNodes(
      [{ ...verifiedFileNode("/a", "aaaa"), errors: ["truncated"] }],
      manifestMeta({ nodeCount: 1, hydratedCount: 1, fullyMaterialized: true }),
    );
    expect(getMountReadiness(manifest)).toBe("partial");
    manifest.writeMeta(
      manifestMeta({ nodeCount: 1, hydratedCount: 1, fullyMaterialized: true, unpackErrors: ["gap"] }),
    );
    expect(getMountReadiness(manifest)).toBe("partial");
    manifest.close();
    await rm(root, { recursive: true, force: true });
  });

  it("persists explicit integrity-verification failure as invalid readiness", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    const rootfs = join(root, ".fs-firmware", "pv-1", "rootfs");
    await mkdir(rootfs, { recursive: true });
    await writeFile(join(rootfs, "a"), "bbbb");
    manifest.replaceNodes(
      [verifiedFileNode("/a", "aaaa")],
      manifestMeta({ nodeCount: 1, hydratedCount: 1, fullyMaterialized: true }),
    );
    expect(() => verifyMountIntegrity(manifest)).toThrow(/do not match/iu);
    expect(getMountReadiness(manifest)).toBe("invalid");
    manifest.close();
    await rm(root, { recursive: true, force: true });
  });

  it("reports corrupt SQLite as invalid and preserves the corrupt bytes", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    const path = manifest.path;
    manifest.close();
    await writeFile(path, "not sqlite", "utf8");
    const corrupt = openManifest(root, "pv-1");
    expect(getMountReadiness(corrupt)).toBe("invalid");
    expect(await readFile(path, "utf8")).toBe("not sqlite");
    corrupt.close();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps a 10,000-node mount invisible to Git", async () => {
    const root = await createIgnoredWorktree();
    const manifest = openManifest(root, "pv-1");
    const placeholderNodes = Array.from({ length: 9_998 }, (_, index) =>
      fileNode(`/usr/share/firmware/file-${index.toString().padStart(5, "0")}`),
    );
    const bytes = "payload";
    const hash = createHash("sha256").update(bytes).digest("hex");
    const materializedNode = { ...verifiedFileNode("/bin/tool", bytes), unixMode: 0o755 };
    const symlinkNode: FirmwareNode = {
      ...fileNode("/bin/tool-link"),
      kind: "symlink",
      fileHash: null,
      size: null,
      symlinkTarget: "tool",
    };
    const nodes = [...placeholderNodes, materializedNode, symlinkNode];
    manifest.replaceNodes(nodes, manifestMeta({ nodeCount: nodes.length, hydratedCount: 1 }));
    const rootfsPath = join(root, ".fs-firmware", "pv-1", "rootfs");
    await mkdir(rootfsPath, { recursive: true });
    const blob = await putBlob(root, Readable.from([bytes]), hash);
    const mount: FirmwareMount = {
      pvId: "pv-1",
      source: "api",
      rootfsPath,
      manifestPath: manifest.path,
      inputSha256: null,
      artifactHash: null,
      readiness: "partial",
      nodeCount: nodes.length,
      hydratedCount: 1,
      errors: [],
    };
    const scope = {
      worktreeRoot: root,
      projectId: "project-1",
      projectVersionId: "pv-1",
      generationId: "generation-1",
    };
    await linkNode(scope, mount, materializedNode, blob.path);
    await linkNode(scope, mount, symlinkNode, "");
    manifest.close();
    await writeFile(join(root, "visible-control.txt"), "control", "utf8");
    const status = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
    });
    expect(status).toContain("visible-control.txt");
    expect(status).not.toContain(".fs-firmware");
    expect((await lstat(join(rootfsPath, "bin", "tool"))).isFile()).toBe(true);
    expect(await readFile(join(rootfsPath, "bin", "tool"), "utf8")).toBe(bytes);
    expect(await readlink(join(rootfsPath, "bin", "tool-link"))).toBe("tool");
    await rm(root, { recursive: true, force: true });
  });
});
