import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openManifest,
  verifyMountIntegrity,
  type FirmwareManifestMeta,
  type FirmwareNode,
} from "../cache/manifest.js";
import { rootfsPath } from "../cache/layout.js";
import {
  assertPreparationCurrent,
  firmwareEnvKey,
  prepareFirmwareForBench,
  startForgeWithPreparedFirmware,
  type BenchProcessLaunch,
} from "./handshake.js";

const roots: string[] = [];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-forge-handshake-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ".fs-firmware/\n");
  return root;
}

function meta(overrides: Partial<FirmwareManifestMeta> = {}): FirmwareManifestMeta {
  return {
    pvId: "pv-1",
    scanId: "scan-1",
    inputSha256: sha256("input"),
    source: "standalone_unpack",
    artifactHash: null,
    fullyMaterialized: true,
    materializedAt: new Date(0).toISOString(),
    nodeCount: 1,
    hydratedCount: 1,
    adminBytesOk: true,
    unpackErrors: [],
    stale: false,
    ...overrides,
  };
}

function fileNode(path: string, bytes: string, materialized = true): FirmwareNode {
  return {
    path,
    kind: "file",
    fileHash: sha256(bytes),
    size: Buffer.byteLength(bytes),
    mimeType: "application/octet-stream",
    fullType: null,
    unixMode: 0o644,
    unixUid: 0,
    unixGid: 0,
    isSetuid: false,
    isSetgid: false,
    symlinkTarget: null,
    materialized,
    errors: [],
  };
}

async function writeMount(
  root: string,
  nodes: readonly FirmwareNode[],
  manifestMeta: FirmwareManifestMeta,
  files: Readonly<Record<string, string>>,
  verify = true,
): Promise<void> {
  const rootfs = rootfsPath(root, "pv-1");
  await mkdir(rootfs, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    const destination = join(rootfs, path.slice(1));
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, bytes);
  }
  const manifest = openManifest(root, "pv-1");
  try {
    manifest.replaceNodes(nodes, manifestMeta);
    if (verify) verifyMountIntegrity(manifest);
  } finally {
    manifest.close();
  }
}

async function fullMount(root: string): Promise<void> {
  await writeMount(root, [fileNode("/bin/app", "verified bytes")], meta(), {
    "/bin/app": "verified bytes",
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// The owned-file list does not include readiness.test.ts, so the complete
// readiness matrix is exercised here through the public preparation seam.
describe("firmware bench readiness", () => {
  it("rejects missing, metadata-only, partial, stale, invalid, and unpack-gap mounts", async () => {
    const missing = await fixture();
    await expect(
      prepareFirmwareForBench({ worktreeRoot: missing }, "pv-1", new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOUNT_MISSING" });

    const metadataOnly = await fixture();
    await writeMount(
      metadataOnly,
      [fileNode("/bin/app", "bytes", false)],
      meta({ fullyMaterialized: false, hydratedCount: 0 }),
      {},
      false,
    );
    await expect(
      prepareFirmwareForBench({ worktreeRoot: metadataOnly }, "pv-1", new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOUNT_INCOMPLETE" });

    const partial = await fixture();
    const partialNodes = [fileNode("/one", "one"), fileNode("/two", "two", false)];
    await writeMount(
      partial,
      partialNodes,
      meta({ fullyMaterialized: false, nodeCount: 2, hydratedCount: 1 }),
      { "/one": "one" },
    );
    await expect(
      prepareFirmwareForBench({ worktreeRoot: partial }, "pv-1", new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOUNT_INCOMPLETE" });

    const stale = await fixture();
    await writeMount(stale, [fileNode("/one", "one")], meta({ stale: true }), { "/one": "one" });
    await expect(
      prepareFirmwareForBench({ worktreeRoot: stale }, "pv-1", new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOUNT_STALE" });

    const invalid = await fixture();
    await fullMount(invalid);
    await writeFile(rootfsPath(invalid, "pv-1") + "/bin/app", "mutated");
    await expect(
      prepareFirmwareForBench({ worktreeRoot: invalid }, "pv-1", new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOUNT_INVALID" });

    const unpackGap = await fixture();
    await writeMount(
      unpackGap,
      [fileNode("/one", "one")],
      meta({ fullyMaterialized: false, unpackErrors: ["missing squashfs bytes"] }),
      { "/one": "one" },
    );
    await expect(
      prepareFirmwareForBench({ worktreeRoot: unpackGap }, "pv-1", new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOUNT_INCOMPLETE", message: expect.stringContaining("missing squashfs bytes") });

    const empty = await fixture();
    await writeMount(
      empty,
      [],
      meta({ nodeCount: 0, hydratedCount: 0 }),
      {},
    );
    await expect(
      prepareFirmwareForBench({ worktreeRoot: empty }, "pv-1", new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOUNT_INCOMPLETE" });
  });
});

describe("firmware bench handshake", () => {
  it("seals a fully materialized preparation and passes its environment before spawn", async () => {
    const root = await fixture();
    await fullMount(root);
    const prepared = await prepareFirmwareForBench(
      { worktreeRoot: root, now: () => new Date(1_000) },
      "pv-1",
      new AbortController().signal,
    );

    const key = firmwareEnvKey("pv-1");
    const canonicalRootfs = await realpath(rootfsPath(root, "pv-1"));
    expect(prepared.environment).toEqual({ [key]: canonicalRootfs });
    expect(prepared.preparedAt).toBe("1970-01-01T00:00:01.000Z");
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.environment)).toBe(true);
    expect(Object.keys(prepared)).toContain("artifactHash");
    expect(Object.keys(prepared)).not.toContain("rootfsPath");
    expect(Object.keys(prepared)).not.toContain("environment");
    expect(JSON.stringify(prepared)).not.toContain(canonicalRootfs);
    expect(JSON.stringify(prepared)).not.toContain(key);

    const start = vi.fn(async (_launch: BenchProcessLaunch, _signal: AbortSignal) => undefined);
    await startForgeWithPreparedFirmware(
      { worktreeRoot: root },
      { kind: "plugin_owned_stdio", hostId: "host-1", command: ["forge", "serve"], start },
      prepared,
      new AbortController().signal,
    );
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]![0]).toEqual({
      hostId: "host-1",
      command: ["forge", "serve"],
      environment: { [key]: canonicalRootfs },
    });
  });

  it("rejects persistent and remote Forge without a verified lifecycle seam", async () => {
    const root = await fixture();
    await fullMount(root);
    const prepared = await prepareFirmwareForBench(
      { worktreeRoot: root },
      "pv-1",
      new AbortController().signal,
    );
    await expect(
      startForgeWithPreparedFirmware(
        { worktreeRoot: root },
        { kind: "persistent", hostId: "host-1", command: ["forge"] },
        prepared,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_REGISTRATION_UNAVAILABLE" });
    await expect(
      startForgeWithPreparedFirmware(
        { worktreeRoot: root },
        { kind: "remote" },
        prepared,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_REGISTRATION_UNAVAILABLE" });
  });

  it("rejects manifest generation and root digest races before dispatch", async () => {
    const generationRoot = await fixture();
    await fullMount(generationRoot);
    const generationPrepared = await prepareFirmwareForBench(
      { worktreeRoot: generationRoot },
      "pv-1",
      new AbortController().signal,
    );
    const manifest = openManifest(generationRoot, "pv-1");
    try {
      manifest.writeMeta({ ...manifest.readMeta()!, scanId: "scan-2" });
    } finally {
      manifest.close();
    }
    await expect(
      assertPreparationCurrent(
        { worktreeRoot: generationRoot },
        generationPrepared,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_CHANGED_DURING_PREPARE" });

    const digestRoot = await fixture();
    await fullMount(digestRoot);
    const digestPrepared = await prepareFirmwareForBench(
      { worktreeRoot: digestRoot },
      "pv-1",
      new AbortController().signal,
    );
    await writeFile(rootfsPath(digestRoot, "pv-1") + "/bin/app", "corrupt after prepare");
    const start = vi.fn(async (_launch: BenchProcessLaunch, _signal: AbortSignal) => undefined);
    await expect(
      startForgeWithPreparedFirmware(
        { worktreeRoot: digestRoot },
        { kind: "plugin_owned_stdio", hostId: "host-1", command: ["forge"], start },
        digestPrepared,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FIRMWARE_CHANGED_DURING_PREPARE" });
    expect(start).not.toHaveBeenCalled();
  });
});
