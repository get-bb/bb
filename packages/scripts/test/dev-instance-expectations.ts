import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";

export interface ExpectedDevPortSet {
  appPort: number;
  hostDaemonPort: number;
  serverPort: number;
}

export interface ExpectedDevInstanceArgs {
  homeDir: string;
  repoRoot: string;
}

const PORT_BUCKETS = 8_000;
const HASH_LENGTH = 12;

export function expectedRepoRootHash(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex");
}

function expectedPortOffset(repoRoot: string): number {
  return (
    Number.parseInt(expectedRepoRootHash(repoRoot).slice(0, 8), 16) %
    PORT_BUCKETS
  );
}

export function expectedDevPorts(repoRoot: string): ExpectedDevPortSet {
  const offset = expectedPortOffset(repoRoot);
  return {
    appPort: 11_000 + offset,
    hostDaemonPort: 27_000 + offset,
    serverPort: 19_000 + offset,
  };
}

function expectedRepoRootLabel(args: ExpectedDevInstanceArgs): string {
  const homeRelativePath = relative(args.homeDir, args.repoRoot);
  if (
    homeRelativePath.length > 0 &&
    !homeRelativePath.startsWith("../") &&
    !homeRelativePath.startsWith("..\\") &&
    homeRelativePath !== ".." &&
    !isAbsolute(homeRelativePath)
  ) {
    return homeRelativePath;
  }

  return args.repoRoot;
}

function expectedSanitizedInstanceLabel(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");
  return sanitized.length > 0 ? sanitized : "worktree";
}

export function expectedDevInstanceId(args: ExpectedDevInstanceArgs): string {
  const hash = expectedRepoRootHash(args.repoRoot);
  const label = expectedRepoRootLabel(args);
  return `${expectedSanitizedInstanceLabel(label)}-${hash.slice(0, HASH_LENGTH)}`;
}

export function expectedDevDataDir(args: ExpectedDevInstanceArgs): string {
  return join(args.homeDir, ".bb-dev", expectedDevInstanceId(args));
}

export function expectedDevServerUrl(repoRoot: string): string {
  return `http://localhost:${expectedDevPorts(repoRoot).serverPort}`;
}
