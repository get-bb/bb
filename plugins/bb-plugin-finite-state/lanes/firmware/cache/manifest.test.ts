import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getMountReadiness,
  openManifest,
  type FirmwareManifestMeta,
  type FirmwareNode,
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

describe("firmware manifest", () => {
  it("creates and idempotently migrates a real SQLite sidecar", async () => {
    const root = await createIgnoredWorktree();
    const first = openManifest(root, "pv-1");
    expect(first.invalidReason).toBeNull();
    expect(first.database.prepare("SELECT name FROM sqlite_master WHERE name = 'fs_node'").get()).toBeTruthy();
    first.close();
    const second = openManifest(root, "pv-1");
    expect(second.database.prepare("SELECT COUNT(*) AS count FROM _fs_migrations").get()).toEqual({ count: 1 });
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
    const nodes = Array.from({ length: 10_000 }, (_, index) =>
      fileNode(`/usr/share/firmware/file-${index.toString().padStart(5, "0")}`),
    );
    manifest.replaceNodes(nodes, manifestMeta({ nodeCount: nodes.length }));
    manifest.close();
    const status = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
    });
    expect(status).not.toContain(".fs-firmware");
    await rm(root, { recursive: true, force: true });
  });
});
