import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { HOST_ARTIFACT_MAX_BYTES } from "@bb/host-daemon-contract";

/**
 * Content-addressed cache for plugin-delivered provider bridge bundles.
 *
 * A bridge artifact is executable code, so the invariant is absolute: bytes
 * are hash-verified BEFORE the atomic rename into the cache, and a cached
 * file is re-verified before every use — the daemon never executes bytes
 * whose sha256 it has not just confirmed. A corrupted download is retried
 * once (transient transport damage), then fails loudly.
 */

const CACHE_DIR_SEGMENT = "provider-bridges";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type FetchProviderBridge = (sha256: string) => Promise<Uint8Array>;

export interface EnsureCachedProviderBridgeArgs {
  dataDir: string;
  fetchProviderBridge: FetchProviderBridge;
  sha256: string;
  byteLength: number;
}

/** In-flight downloads keyed by `${dataDir}\0${sha256}` so concurrent
 *  commands for the same artifact share one pull. */
const pendingBridgePulls = new Map<string, Promise<string>>();

function isFsErrorWithCode(error: Error, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyCachedFile(
  filePath: string,
  sha256: string,
): Promise<boolean> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
  if (sha256Hex(bytes) === sha256) {
    return true;
  }
  // Corrupted cache entry: never serve it, remove it so the download path
  // replaces it.
  await fs.rm(filePath, { force: true });
  return false;
}

function describeMismatch(
  sha256: string,
  bytes: Uint8Array,
  expectedByteLength: number,
): string | null {
  if (bytes.byteLength !== expectedByteLength) {
    return `expected ${expectedByteLength} bytes, received ${bytes.byteLength}`;
  }
  const actual = sha256Hex(bytes);
  if (actual !== sha256) {
    return `expected sha256 ${sha256}, received ${actual}`;
  }
  return null;
}

/**
 * Ensure the bridge artifact is cached at
 * `<dataDir>/provider-bridges/<sha256>.mjs` and return that absolute path.
 * Downloads via the authenticated server client when missing; verifies the
 * sha256 (and declared byte length) over the received bytes before an atomic
 * rename into place; on mismatch deletes the staged bytes and retries once.
 */
export async function ensureCachedProviderBridge(
  args: EnsureCachedProviderBridgeArgs,
): Promise<string> {
  if (!SHA256_PATTERN.test(args.sha256)) {
    throw new Error(`Invalid provider bridge sha256: "${args.sha256}"`);
  }
  // The download is buffered whole to hash-verify it before it can be
  // executed, so the declared size is checked before a byte is fetched. The
  // wire schema enforces the same cap; this is the guard for callers that
  // build the args themselves.
  if (args.byteLength > HOST_ARTIFACT_MAX_BYTES) {
    throw new Error(
      `Provider bridge is too large: ${args.byteLength} bytes exceeds the ${HOST_ARTIFACT_MAX_BYTES}-byte limit`,
    );
  }
  const key = `${args.dataDir}\0${args.sha256}`;
  const pending = pendingBridgePulls.get(key);
  if (pending) {
    return pending;
  }
  const pull = ensureCachedProviderBridgeUnlocked(args).finally(() => {
    pendingBridgePulls.delete(key);
  });
  pendingBridgePulls.set(key, pull);
  return pull;
}

async function ensureCachedProviderBridgeUnlocked(
  args: EnsureCachedProviderBridgeArgs,
): Promise<string> {
  const cacheDir = path.join(args.dataDir, CACHE_DIR_SEGMENT);
  const filePath = path.join(cacheDir, `${args.sha256}.mjs`);
  if (await verifyCachedFile(filePath, args.sha256)) {
    return filePath;
  }

  await fs.mkdir(cacheDir, { recursive: true });
  let lastMismatch: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const bytes = await args.fetchProviderBridge(args.sha256);
    lastMismatch = describeMismatch(args.sha256, bytes, args.byteLength);
    if (lastMismatch !== null) {
      continue;
    }
    const stagePath = path.join(
      cacheDir,
      `.tmp-${args.sha256}-${process.pid}-${randomUUID()}`,
    );
    try {
      await fs.writeFile(stagePath, bytes);
      // Same directory, so the rename is atomic; a concurrent writer of the
      // same content-addressed path produces identical bytes, so whichever
      // rename lands last is equally valid.
      await fs.rename(stagePath, filePath);
    } catch (error) {
      await fs.rm(stagePath, { force: true });
      throw error;
    }
    return filePath;
  }
  throw new Error(
    `Provider bridge download failed verification after retry: ${lastMismatch ?? "unknown mismatch"}`,
  );
}
