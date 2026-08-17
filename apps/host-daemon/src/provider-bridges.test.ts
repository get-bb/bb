import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
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

const silentLogger = { debug: () => undefined, warn: () => undefined };

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "bb-provider-bridges-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function cachePath(sha256: string): string {
  return join(dataDir, "provider-bridges", sha256, "bridge.mjs");
}

describe("ensureCachedProviderBridge", () => {
  it("downloads, verifies, and caches the artifact; later calls skip the fetch", async () => {
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));

    const path = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      logger: silentLogger,
      byteLength: BRIDGE_BYTES.byteLength,
    });

    expect(path).toBe(cachePath(BRIDGE_SHA));
    expect(await readFile(path)).toEqual(BRIDGE_BYTES);
    expect(fetchProviderBridge).toHaveBeenCalledTimes(1);

    const again = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      logger: silentLogger,
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
      logger: silentLogger,
      byteLength: BRIDGE_BYTES.byteLength,
    });

    expect(fetchProviderBridge).toHaveBeenCalledTimes(2);
    expect(await readFile(path)).toEqual(BRIDGE_BYTES);
    // Atomicity: no .tmp- staging leftovers.
    const entries = await readdir(
      join(dataDir, "provider-bridges", BRIDGE_SHA),
    );
    expect(entries).toEqual(["bridge.mjs"]);
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
        logger: silentLogger,
        byteLength: BRIDGE_BYTES.byteLength,
      }),
    ).rejects.toThrow(/failed verification after retry/);

    expect(fetchProviderBridge).toHaveBeenCalledTimes(2);
    // Nothing unverified may remain on disk.
    const entries = await readdir(
      join(dataDir, "provider-bridges", BRIDGE_SHA),
    ).catch(() => []);
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
        logger: silentLogger,
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
      logger: silentLogger,
      byteLength: BRIDGE_BYTES.byteLength,
    });

    // Corrupt the cache entry in place; the next ensure must not serve it.
    await writeFile(path, "tampered bytes");
    const again = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      logger: silentLogger,
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
        logger: silentLogger,
        byteLength: 1,
      }),
    ).rejects.toThrow(/Invalid artifact digest/);
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
        logger: silentLogger,
        byteLength: HOST_ARTIFACT_MAX_BYTES + 1,
      }),
    ).rejects.toThrow(/too large/);
    expect(fetchProviderBridge).not.toHaveBeenCalled();
  });

  it("stages the artifact owner-only; a shared host cannot read a bridge", async () => {
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));
    const path = await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      logger: silentLogger,
      byteLength: BRIDGE_BYTES.byteLength,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  // Several providers run at once, so pruning is by disuse, not by "keep the
  // current digest" — that would delete a live sibling's bridge on every
  // launch and ping-pong the two downloads forever.
  it("prunes a bridge nothing has launched for a month and keeps live siblings", async () => {
    const fetchProviderBridge = vi.fn(async () => new Uint8Array(BRIDGE_BYTES));
    const otherBytes = Buffer.from("export function other() {}\n");
    const otherSha = createHash("sha256").update(otherBytes).digest("hex");
    const staleSha = createHash("sha256")
      .update(Buffer.from("stale\n"))
      .digest("hex");

    await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge: async () => new Uint8Array(otherBytes),
      sha256: otherSha,
      logger: silentLogger,
      byteLength: otherBytes.byteLength,
    });
    const staleDir = join(dataDir, "provider-bridges", staleSha);
    await mkdir(staleDir, { recursive: true });
    const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await utimes(staleDir, longAgo, longAgo);

    await ensureCachedProviderBridge({
      dataDir,
      fetchProviderBridge,
      sha256: BRIDGE_SHA,
      logger: silentLogger,
      byteLength: BRIDGE_BYTES.byteLength,
    });

    const entries = await readdir(join(dataDir, "provider-bridges"));
    expect(entries.sort()).toEqual([BRIDGE_SHA, otherSha].sort());
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
