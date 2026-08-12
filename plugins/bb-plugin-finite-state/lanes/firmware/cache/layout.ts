import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const FIRMWARE_CACHE_DIRECTORY = ".fs-firmware";

export class FirmwareCacheError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FirmwareCacheError";
  }
}

export function validatePvId(pvId: string): string {
  if (
    pvId.length < 1 ||
    pvId.length > 200 ||
    pvId === "." ||
    pvId === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(pvId)
  ) {
    throw new FirmwareCacheError(
      "INVALID_PROJECT_VERSION_ID",
      "The project-version id is not a safe cache path segment.",
    );
  }
  return pvId;
}

export function validateSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new FirmwareCacheError(
      "INVALID_SHA256",
      "Expected a lowercase SHA-256 digest.",
    );
  }
  return value;
}

export function validateWorktreeRoot(worktreeRoot: string): string {
  if (!isAbsolute(worktreeRoot)) {
    throw new FirmwareCacheError(
      "INVALID_WORKTREE_ROOT",
      "The worktree root must be an explicit absolute path.",
    );
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(worktreeRoot);
    if (!statSync(canonicalRoot).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new FirmwareCacheError(
      "INVALID_WORKTREE_ROOT",
      "The worktree root must name an existing directory.",
      { cause: error },
    );
  }

  let gitRoot: string;
  try {
    gitRoot = execFileSync("git", ["-C", canonicalRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    throw new FirmwareCacheError(
      "INVALID_WORKTREE_ROOT",
      "Firmware cache operations require a Git worktree root.",
      { cause: error },
    );
  }

  if (realpathSync(gitRoot) !== canonicalRoot) {
    throw new FirmwareCacheError(
      "INVALID_WORKTREE_ROOT",
      "The supplied path is inside a worktree but is not its root.",
    );
  }
  return canonicalRoot;
}

export function assertFirmwareCacheIgnored(worktreeRoot: string): string {
  const root = validateWorktreeRoot(worktreeRoot);
  try {
    execFileSync(
      "git",
      ["-C", root, "check-ignore", "--quiet", "--no-index", "--", `${FIRMWARE_CACHE_DIRECTORY}/.ignore-probe`],
      { stdio: "ignore" },
    );
  } catch (error) {
    throw new FirmwareCacheError(
      "FIRMWARE_CACHE_NOT_IGNORED",
      `${FIRMWARE_CACHE_DIRECTORY} must be ignored before firmware cache files are created.`,
      { cause: error },
    );
  }
  return root;
}

export function firmwareCacheRoot(worktreeRoot: string): string {
  return join(resolve(worktreeRoot), FIRMWARE_CACHE_DIRECTORY);
}

export function mountRoot(worktreeRoot: string, pvId: string): string {
  return join(firmwareCacheRoot(worktreeRoot), validatePvId(pvId));
}

export function rootfsPath(worktreeRoot: string, pvId: string): string {
  return join(mountRoot(worktreeRoot, pvId), "rootfs");
}

export function manifestPath(worktreeRoot: string, pvId: string): string {
  return join(mountRoot(worktreeRoot, pvId), "manifest.sqlite");
}

export function globalBlobsPath(worktreeRoot: string): string {
  return join(firmwareCacheRoot(worktreeRoot), "blobs");
}

export function blobPath(worktreeRoot: string, sha256: string): string {
  return join(globalBlobsPath(worktreeRoot), validateSha256(sha256));
}

export function stagingPath(worktreeRoot: string, pvId?: string): string {
  return pvId
    ? join(mountRoot(worktreeRoot, pvId), "staging")
    : join(firmwareCacheRoot(worktreeRoot), "staging");
}

export function trashPath(worktreeRoot: string): string {
  return join(firmwareCacheRoot(worktreeRoot), "trash");
}

export function recoveryPath(worktreeRoot: string, pvId: string): string {
  return join(mountRoot(worktreeRoot, pvId), "recovery");
}
