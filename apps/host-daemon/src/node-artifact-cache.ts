import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { HOST_ARTIFACT_MAX_BYTES } from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";

/**
 * The daemon's one content-addressed cache for executable artifacts it is
 * asked to run: plugin host bundles and provider bridge bundles alike.
 *
 * The invariant is absolute and identical for both: the bytes are
 * hash-verified BEFORE the atomic rename into the cache, and a cached file is
 * re-verified before every use — the daemon never executes bytes whose digest
 * it has not just confirmed. A download that fails verification is retried
 * once (transient transport damage), then fails loudly.
 *
 * Layout is `<cacheDir>/<digest>/<fileName>`. The caller owns `cacheDir`, so
 * the scoping question ("one family per plugin" vs "one family per delivery
 * path") stays with the caller and this function stays generic.
 */

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export type FetchNodeArtifact = (args: {
  digest: string;
  byteLength: number;
}) => Promise<Uint8Array>;

/**
 * What to do with the digests in `cacheDir` that are not the one just used.
 *
 * - `keep-only-current`: for a family with exactly one live artifact at a
 *   time (a plugin's host bundle), where any other digest is superseded.
 * - `keep-recently-used`: for a family whose members are live concurrently
 *   (provider bridges — several providers run at once and the daemon cannot
 *   tell which digests belong to which plugin until bridges become host
 *   artifacts). Every use touches its digest directory, so age is a real
 *   "nobody has run this in a month" signal rather than a guess.
 */
export type NodeArtifactPruneStrategy =
  | { kind: "keep-only-current" }
  | { kind: "keep-recently-used"; maxAgeMs: number };

export interface EnsureCachedNodeArtifactArgs {
  /** Root of one artifact family. Digest directories are its children. */
  cacheDir: string;
  digest: string;
  byteLength: number;
  /** Basename inside the digest directory, e.g. `host.mjs`. */
  fileName: string;
  /** Previous basenames that may contain the same verified artifact. */
  legacyFileNames?: readonly string[];
  fetchArtifact: FetchNodeArtifact;
  prune: NodeArtifactPruneStrategy;
  logger: Pick<HostDaemonLogger, "debug" | "warn">;
}

/** In-flight pulls keyed by `${cacheDir}\0${digest}` so concurrent callers
 *  for the same artifact share one download. */
const pendingPulls = new Map<string, Promise<string>>();

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function describeMismatch(
  digest: string,
  byteLength: number,
  bytes: Uint8Array,
): string | null {
  if (bytes.byteLength !== byteLength) {
    return `expected ${byteLength} bytes, received ${bytes.byteLength}`;
  }
  const actual = sha256Hex(bytes);
  if (actual !== digest) {
    return `expected sha256 ${digest}, received ${actual}`;
  }
  return null;
}

/**
 * Ensure the artifact is cached at `<cacheDir>/<digest>/<fileName>` and return
 * that absolute path. Verifies a cached file before returning it, downloads
 * through the injected fetch when it is missing or corrupt, verifies the
 * received bytes before an atomic rename into place, retries once on
 * verification failure, and then prunes according to {@link
 * NodeArtifactPruneStrategy}.
 */
export async function ensureCachedNodeArtifact(
  args: EnsureCachedNodeArtifactArgs,
): Promise<string> {
  if (!DIGEST_PATTERN.test(args.digest)) {
    throw new Error(`Invalid artifact digest: "${args.digest}"`);
  }
  // The download is buffered whole to hash-verify it before it can be
  // executed, so the declared size is checked before a byte is fetched. The
  // wire schemas enforce the same cap; this is the guard for callers that
  // build the args themselves.
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
    await removeLegacyArtifactFiles(directory, args);
    await touchDirectory(directory);
    await pruneStaleDigests(args);
    return artifactPath;
  }

  const migratedLegacyPath = await migrateLegacyArtifact(
    directory,
    artifactPath,
    args,
  );
  if (migratedLegacyPath) {
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
    const bytes = await args.fetchArtifact({
      digest: args.digest,
      byteLength: args.byteLength,
    });
    const mismatch = describeMismatch(args.digest, args.byteLength, bytes);
    if (mismatch !== null) {
      lastMismatch = mismatch;
      continue;
    }
    const staged = join(directory, `.staged-${randomUUID()}.tmp`);
    try {
      // 0o600: the artifact is executable code, and the daemon data dir can
      // be readable by other accounts on a shared host.
      await writeFile(staged, bytes, { mode: 0o600 });
      // Same directory, so the rename is atomic; a concurrent writer of the
      // same content-addressed path produces identical bytes, so whichever
      // rename lands last is equally valid.
      await rename(staged, artifactPath);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
    await removeLegacyArtifactFiles(directory, args);
    await pruneStaleDigests(args);
    return artifactPath;
  }
  throw new Error(
    `Host artifact download failed verification after retry: ${lastMismatch}`,
  );
}

async function migrateLegacyArtifact(
  directory: string,
  artifactPath: string,
  args: EnsureCachedNodeArtifactArgs,
): Promise<boolean> {
  for (const legacyFileName of args.legacyFileNames ?? []) {
    if (legacyFileName === args.fileName) continue;
    const legacyPath = join(directory, legacyFileName);
    if (!(await isVerifiedCachedArtifact(legacyPath, args))) continue;

    await rename(legacyPath, artifactPath);
    args.logger.debug(
      {
        cacheDir: args.cacheDir,
        digest: args.digest,
        legacyFileName,
        fileName: args.fileName,
      },
      "Migrated cached host artifact",
    );
    await removeLegacyArtifactFiles(directory, args);
    return true;
  }
  return false;
}

async function removeLegacyArtifactFiles(
  directory: string,
  args: EnsureCachedNodeArtifactArgs,
): Promise<void> {
  const legacyPaths = (args.legacyFileNames ?? [])
    .filter((fileName) => fileName !== args.fileName)
    .map((fileName) => join(directory, fileName));
  const results = await Promise.allSettled(
    legacyPaths.map((path) => rm(path, { force: true })),
  );
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    args.logger.warn(
      { path: legacyPaths[index], err: result.reason },
      "Failed to remove legacy host artifact",
    );
  });
}

async function isVerifiedCachedArtifact(
  artifactPath: string,
  args: EnsureCachedNodeArtifactArgs,
): Promise<boolean> {
  let bytes: Buffer;
  try {
    bytes = await readFile(artifactPath);
  } catch {
    return false;
  }
  if (
    bytes.byteLength === args.byteLength &&
    sha256Hex(bytes) === args.digest
  ) {
    return true;
  }
  // Corrupted cache entry: never serve it, remove it so the download path
  // replaces it.
  await rm(artifactPath, { force: true });
  return false;
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
  const candidates = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      entry.name !== args.digest &&
      DIGEST_PATTERN.test(entry.name),
  );
  const stale: string[] = [];
  for (const entry of candidates) {
    const directory = join(args.cacheDir, entry.name);
    if (args.prune.kind === "keep-only-current") {
      stale.push(directory);
      continue;
    }
    const stats = await stat(directory).catch(() => null);
    if (stats !== null && Date.now() - stats.mtimeMs > args.prune.maxAgeMs) {
      stale.push(directory);
    }
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
