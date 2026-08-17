import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hostDaemonBridgeLaunchSchema,
  HOST_ARTIFACT_MAX_BYTES,
} from "@bb/host-daemon-contract";
import { ensureCachedProviderBridge } from "./provider-bridges.js";

const BRIDGE_BYTES = Buffer.from(
  'export function handleLine() { return "ok"; }\n',
);
const BRIDGE_SHA = createHash("sha256").update(BRIDGE_BYTES).digest("hex");

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "bb-provider-bridges-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function cachePath(sha256: string): string {
  return join(dataDir, "provider-bridges", `${sha256}.mjs`);
}

describe("ensureCachedProviderBridge", () => {
  it("downloads, verifies, and caches the artifact; later calls skip the fetch", async () => {
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));

    const path = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      byteLength: BRIDGE_BYTES.byteLength,
    });

    expect(path).toBe(cachePath(BRIDGE_SHA));
    expect(await readFile(path)).toEqual(BRIDGE_BYTES);
    expect(fetchProviderBridge).toHaveBeenCalledTimes(1);

    const again = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      byteLength: BRIDGE_BYTES.byteLength,
    });
    expect(again).toBe(path);
    expect(fetchProviderBridge).toHaveBeenCalledTimes(1);
  });

  it("retries once on a corrupted payload and never leaves partial files", async () => {
    const fetchProviderBridge = vi
      .fn<() => Promise<Uint8Array>>()
      .mockResolvedValueOnce(new Uint8Array(Buffer.from("corrupted bytes")))
      .mockResolvedValueOnce(new Uint8Array(BRIDGE_BYTES));

    const path = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      byteLength: BRIDGE_BYTES.byteLength,
    });

    expect(fetchProviderBridge).toHaveBeenCalledTimes(2);
    expect(await readFile(path)).toEqual(BRIDGE_BYTES);
    // Atomicity: no .tmp- staging leftovers.
    const entries = await readdir(join(dataDir, "provider-bridges"));
    expect(entries).toEqual([`${BRIDGE_SHA}.mjs`]);
  });

  it("refuses a persistently corrupted payload after one retry", async () => {
    const fetchProviderBridge = vi.fn(
      async () => new Uint8Array(Buffer.from("still corrupted")),
    );

    await expect(
      ensureCachedProviderBridge({
        dataDir,
        fetchProviderBridge,
        sha256: BRIDGE_SHA,
        byteLength: BRIDGE_BYTES.byteLength,
      }),
    ).rejects.toThrow(/failed verification after retry/);

    expect(fetchProviderBridge).toHaveBeenCalledTimes(2);
    // Nothing unverified may remain on disk.
    const entries = await readdir(join(dataDir, "provider-bridges")).catch(
      () => [],
    );
    expect(entries).toEqual([]);
  });

  it("rejects bytes whose length disagrees with the declared byteLength", async () => {
    // Hash matches but the declared length does not: the spec lied, refuse it.
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));
    await expect(
      ensureCachedProviderBridge({
        dataDir,
        fetchProviderBridge,
        sha256: BRIDGE_SHA,
        byteLength: BRIDGE_BYTES.byteLength + 1,
      }),
    ).rejects.toThrow(/expected \d+ bytes/);
  });

  it("re-verifies a cached file and replaces one corrupted on disk", async () => {
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));
    const path = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      byteLength: BRIDGE_BYTES.byteLength,
    });

    // Corrupt the cache entry in place; the next ensure must not serve it.
    await writeFile(path, "tampered bytes");
    const again = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      byteLength: BRIDGE_BYTES.byteLength,
    });
    expect(again).toBe(path);
    expect(await readFile(path)).toEqual(BRIDGE_BYTES);
    expect(fetchProviderBridge).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed sha256 inputs before touching the network", async () => {
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));
    await expect(
      ensureCachedProviderBridge({
        dataDir,
        fetchProviderBridge,
        sha256: "../../../etc/passwd",
        byteLength: 1,
      }),
    ).rejects.toThrow(/Invalid provider bridge sha256/);
    expect(fetchProviderBridge).not.toHaveBeenCalled();
  });

  // The download is buffered whole before it can be verified, so the size has
  // to be refused from the declaration, before any bytes arrive.
  it("refuses an oversized artifact before touching the network", async () => {
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));
    await expect(
      ensureCachedProviderBridge({
        dataDir,
        fetchProviderBridge,
        sha256: BRIDGE_SHA,
        byteLength: HOST_ARTIFACT_MAX_BYTES + 1,
      }),
    ).rejects.toThrow(/too large/);
    expect(fetchProviderBridge).not.toHaveBeenCalled();
  });
});

describe("bridgeLaunch wire schema", () => {
  it("refuses to carry an oversized artifact at all", () => {
    const launch = {
      source: {
        kind: "artifact",
        sha256: BRIDGE_SHA,
        byteLength: HOST_ARTIFACT_MAX_BYTES + 1,
      },
      capabilities: {
        supportsServiceTier: false,
        permissionModes: ["full"],
        supportsThreadArchive: false,
        supportsThreadRename: false,
        fork: "none",
      },
    };
    expect(hostDaemonBridgeLaunchSchema.safeParse(launch).success).toBe(false);
    expect(
      hostDaemonBridgeLaunchSchema.safeParse({
        ...launch,
        source: {
          ...launch.source,
          byteLength: HOST_ARTIFACT_MAX_BYTES,
        },
      }).success,
    ).toBe(true);
  });
});
