import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import {
  FileTransferVerificationError,
  hashFile,
  writeVerifiedFile,
} from "@bb/file-transfer";
import { HOST_ARTIFACT_MAX_BYTES } from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const RACY_TIMESTAMP_WINDOW_NS = 2_000_000_000n;
const ARTIFACT_MODE = 0o600;

type FetchNodeArtifact = (args: {
  digest: string;
  byteLength: number;
}) => Promise<AsyncIterable<Uint8Array>>;

interface EnsureCachedNodeArtifactArgs {
  cacheDir: string;
  digest: string;
  byteLength: number;
  fileName: string;
  fetchArtifact: FetchNodeArtifact;
  logger: Pick<HostDaemonLogger, "debug" | "warn">;
}

const pendingPulls = new Map<string, Promise<string>>();
const verifiedArtifactStatKeys = new Map<string, string>();

export async function ensureCachedNodeArtifact(
  args: EnsureCachedNodeArtifactArgs,
): Promise<string> {
  if (!DIGEST_PATTERN.test(args.digest)) {
    throw new Error(`Invalid artifact digest: "${args.digest}"`);
  }
  if (args.byteLength > HOST_ARTIFACT_MAX_BYTES) {
    throw new Error(
      `Artifact is too large: ${args.byteLength} bytes exceeds the ${HOST_ARTIFACT_MAX_BYTES}-byte limit`,
    );
  }
  const key = `${args.cacheDir}\0${args.digest}`;
  const pending = pendingPulls.get(key);
  if (pending !== undefined) {
    return pending;
  }
  const pull = ensureCachedNodeArtifactUnlocked(args).finally(() => {
    pendingPulls.delete(key);
  });
  pendingPulls.set(key, pull);
  return pull;
}

async function ensureCachedNodeArtifactUnlocked(
  args: EnsureCachedNodeArtifactArgs,
): Promise<string> {
  const directory = join(args.cacheDir, args.digest);
  const artifactPath = join(directory, args.fileName);
  if (await isVerifiedCachedArtifact(artifactPath, args)) {
    args.logger.debug(
      { cacheDir: args.cacheDir, digest: args.digest },
      "Using cached host artifact",
    );
    await touchDirectory(directory);
    await pruneStaleDigests(args);
    return artifactPath;
  }

  args.logger.debug(
    { cacheDir: args.cacheDir, digest: args.digest },
    "Downloading host artifact",
  );
  await mkdir(directory, { recursive: true });
  let lastMismatch = "unknown mismatch";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const staged = join(directory, `.staged-${randomUUID()}.tmp`);
    try {
      await writeVerifiedFile({
        destinationPath: staged,
        durable: false,
        expected: {
          maxBytes: HOST_ARTIFACT_MAX_BYTES,
          sha256: args.digest,
          sizeBytes: args.byteLength,
        },
        label: "Host artifact",
        mode: { kind: "create", mode: ARTIFACT_MODE },
        source: await args.fetchArtifact({
          digest: args.digest,
          byteLength: args.byteLength,
        }),
      });
    } catch (error) {
      if (!(error instanceof FileTransferVerificationError)) throw error;
      lastMismatch = error.message;
      continue;
    }
    try {
      await rename(staged, artifactPath);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
    await pruneStaleDigests(args);
    return artifactPath;
  }
  throw new Error(
    `Host artifact download failed verification after retry: ${lastMismatch}`,
  );
}

async function isVerifiedCachedArtifact(
  artifactPath: string,
  args: EnsureCachedNodeArtifactArgs,
): Promise<boolean> {
  const before = await stat(artifactPath, { bigint: true }).catch(() => null);
  if (before === null) {
    verifiedArtifactStatKeys.delete(artifactPath);
    return false;
  }
  const statKey = fileStatKey(before);
  if (verifiedArtifactStatKeys.get(artifactPath) === statKey) {
    return true;
  }
  verifiedArtifactStatKeys.delete(artifactPath);
  if (before.isFile() && before.size === BigInt(args.byteLength)) {
    const hashed = await hashFile(artifactPath).catch(() => null);
    if (
      hashed?.sha256 === args.digest &&
      hashed.sizeBytes === args.byteLength
    ) {
      const after = await stat(artifactPath, { bigint: true });
      if (fileStatKey(after) === statKey && !hasRacyTimestamp(after)) {
        verifiedArtifactStatKeys.set(artifactPath, statKey);
      }
      return true;
    }
  }
  await rm(artifactPath, { force: true });
  return false;
}

function fileStatKey(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(
    ":",
  );
}

function hasRacyTimestamp(stats: BigIntStats): boolean {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  return (
    nowNs - stats.mtimeNs < RACY_TIMESTAMP_WINDOW_NS ||
    nowNs - stats.ctimeNs < RACY_TIMESTAMP_WINDOW_NS
  );
}

async function touchDirectory(directory: string): Promise<void> {
  const now = new Date();
  await utimes(directory, now, now).catch(() => undefined);
}

async function pruneStaleDigests(
  args: EnsureCachedNodeArtifactArgs,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(args.cacheDir, { withFileTypes: true });
  } catch (error) {
    args.logger.warn(
      { cacheDir: args.cacheDir, err: error },
      "Failed to inspect host artifact cache",
    );
    return;
  }
  const stale = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== args.digest &&
        DIGEST_PATTERN.test(entry.name),
    )
    .map((entry) => join(args.cacheDir, entry.name));
  for (const directory of stale) {
    verifiedArtifactStatKeys.delete(join(directory, args.fileName));
  }
  const results = await Promise.allSettled(
    stale.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    args.logger.warn(
      { directory: stale[index], err: result.reason },
      "Failed to prune stale host artifact",
    );
  });
}
