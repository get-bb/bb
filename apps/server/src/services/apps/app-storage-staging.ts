import { randomUUID } from "node:crypto";
import type { ApplicationId } from "@bb/domain";

/**
 * App dirs are published crash-safely: stage into a `.tmp-` dir then rename
 * into place, and delete by renaming to a `.delete-` tombstone then removing
 * it. These prefixes are load-bearing — discovery skips them so a half-written
 * or being-deleted dir never surfaces as a real app. Keeping the prefixes,
 * nonce shape, and the discovery filter in one module guarantees the writers
 * (route scaffolding, app-source sync) and the reader (discovery) stay aligned.
 */
const TEMP_PREFIX = ".tmp-";
const TOMBSTONE_PREFIX = ".delete-";

function createNonce(): string {
  return randomUUID().replaceAll("-", "").slice(0, 16);
}

export function isIgnoredApplicationStorageEntry(entryName: string): boolean {
  return (
    entryName.startsWith(TEMP_PREFIX) || entryName.startsWith(TOMBSTONE_PREFIX)
  );
}

export function appStorageTempDirName(applicationId: ApplicationId): string {
  return `${TEMP_PREFIX}${applicationId}-${createNonce()}`;
}

export function appStorageTombstoneDirName(name: string): string {
  return `${TOMBSTONE_PREFIX}${name}-${createNonce()}`;
}
