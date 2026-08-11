import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  cp,
  lstat,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import semver from "semver";
import { spawnPortableOutputProcess } from "@bb/process-utils";

/**
 * Parsed `bb plugin install` source spec (design §6). The original spec is
 * retained for display/diagnostics; normalized persistence is authoritative.
 */
export type ParsedPluginSource =
  | { kind: "path"; path: string }
  | { kind: "builtin"; name: string }
  | {
      kind: "git";
      /** Clone URL (https, or an on-disk repo path). */
      url: string;
      /** Requested branch, tag, or commit. Classified with ls-remote. */
      ref: string;
      /** Managed dir relative to <dataDir>/plugins/git: "<host>/<path>@<ref>". */
      installDir: string;
      /** Cache namespace relative to plugins/cache/git: "<host>/<path>". */
      cachePath: string;
    }
  | {
      kind: "npm";
      name: string;
      /** Empty for an omitted spec (`npm:pkg`). */
      spec: string;
      specKind: "default" | "exact" | "tag" | "range";
    };

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
export const DEFAULT_GIT_REF = "HEAD";
// Loose npm package-name shape; enough to keep names safe as path segments.
const NPM_NAME_PATTERN =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const BUILTIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isCommitSha(ref: string): boolean {
  return COMMIT_SHA_PATTERN.test(ref);
}

function assertSafeSegments(value: string, label: string): void {
  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`invalid ${label} "${value}"`);
  }
}

function parseGitSource(spec: string): ParsedPluginSource {
  const at = spec.lastIndexOf("@");
  if (at === spec.length - 1) {
    throw new Error("git source has an empty ref");
  }
  const urlish = at <= 0 ? spec : spec.slice(0, at);
  const ref = at <= 0 ? DEFAULT_GIT_REF : spec.slice(at + 1);
  if (ref.startsWith("-") || ref.includes("..")) {
    throw new Error(`invalid git ref "${ref}"`);
  }
  let url: string;
  let host: string;
  let repoPath: string;
  let decodedUrlish: string;
  try {
    decodedUrlish = decodeURIComponent(urlish);
  } catch {
    throw new Error(`invalid git url "${urlish}"`);
  }
  if (decodedUrlish.split("/").some((segment) => segment === "..")) {
    throw new Error(`invalid git repository path "${urlish}"`);
  }
  if (/^https?:\/\//.test(urlish)) {
    const parsed = new URL(urlish);
    url = urlish;
    host = parsed.host;
    repoPath = parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  } else if (urlish.startsWith("/")) {
    // An on-disk repository (dev setups, tests). Grouped under "local".
    url = urlish;
    host = "local";
    repoPath = urlish.replace(/^\/+/, "").replace(/\.git$/, "");
  } else if (/^[a-z0-9]/i.test(urlish)) {
    // Shorthand: git:github.com/user/repo@ref
    url = `https://${urlish}`;
    const parsed = new URL(url);
    host = parsed.host;
    repoPath = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
  } else {
    throw new Error(`invalid git url "${urlish}"`);
  }
  if (repoPath.length === 0) {
    throw new Error(`git url "${urlish}" has no repository path`);
  }
  assertSafeSegments(repoPath, "git repository path");
  if (host.includes("..") || host.includes("/")) {
    throw new Error(`invalid git host "${host}"`);
  }
  return {
    kind: "git",
    url,
    ref,
    installDir: `${host}/${repoPath}@${ref}`,
    cachePath: `${host}/${repoPath}`,
  };
}

function parseNpmSource(spec: string): ParsedPluginSource {
  const at = spec.lastIndexOf("@");
  const hasSpec = at > 0 && at < spec.length - 1;
  if (at > 0 && at === spec.length - 1) {
    throw new Error(`npm source has an empty version spec: "${spec}"`);
  }
  const name = hasSpec ? spec.slice(0, at) : spec;
  const requestedSpec = hasSpec ? spec.slice(at + 1) : "";
  if (!NPM_NAME_PATTERN.test(name)) {
    throw new Error(`invalid npm package name "${name}"`);
  }
  if (requestedSpec.length === 0) {
    return { kind: "npm", name, spec: "", specKind: "default" };
  }
  if (semver.valid(requestedSpec) !== null) {
    return { kind: "npm", name, spec: requestedSpec, specKind: "exact" };
  }
  if (semver.validRange(requestedSpec) !== null) {
    return { kind: "npm", name, spec: requestedSpec, specKind: "range" };
  }
  if (/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(requestedSpec)) {
    return { kind: "npm", name, spec: requestedSpec, specKind: "tag" };
  }
  throw new Error(`invalid npm version, range, or dist-tag "${requestedSpec}"`);
}

function parseBuiltinSource(spec: string): ParsedPluginSource {
  if (!BUILTIN_NAME_PATTERN.test(spec)) {
    throw new Error(
      `invalid builtin plugin name "${spec}" — use lowercase letters, digits, and dashes`,
    );
  }
  return { kind: "builtin", name: spec };
}

/** Parse an install source spec. Bare HTTP(S) URLs are managed Git sources. */
export function parsePluginSource(source: string): ParsedPluginSource {
  if (source.startsWith("builtin:")) return parseBuiltinSource(source.slice(8));
  if (source.startsWith("git:")) return parseGitSource(source.slice(4));
  if (source.startsWith("npm:")) return parseNpmSource(source.slice(4));
  if (/^https?:\/\//iu.test(source)) return parseGitSource(source);
  const path = source.startsWith("path:") ? source.slice(5) : source;
  if (path.length === 0) throw new Error("install source path is empty");
  return { kind: "path", path };
}

/** Managed npm install prefix; the plugin root is <prefix>/node_modules/<name>. */
export function npmInstallPrefix(
  dataDir: string,
  name: string,
  version: string,
): string {
  return join(dataDir, "plugins", "npm", ...`${name}@${version}`.split("/"));
}

function resolveInside(root: string, segments: string[], label: string): string {
  for (const segment of segments) assertSafeSegments(segment, label);
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, ...segments);
  const pathFromRoot = relative(absoluteRoot, target);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`invalid ${label} cache path`);
  }
  return target;
}

/** Resolve symlinks and require target to remain within root. */
export async function realPathInside(
  root: string,
  target: string,
  label: string,
): Promise<string> {
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target),
  ]);
  const fromRoot = relative(realRoot, realTarget);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`${label} resolves outside its root`);
  }
  return realTarget;
}

/** Immutable npm install prefix: node_modules lives beneath this directory. */
export function npmArtifactCacheDir(
  dataDir: string,
  packageName: string,
  version: string,
): string {
  if (!NPM_NAME_PATTERN.test(packageName)) {
    throw new Error(`invalid npm package name "${packageName}"`);
  }
  return resolveInside(
    join(dataDir, "plugins", "cache", "npm"),
    [...packageName.split("/"), version],
    "npm artifact",
  );
}

/** Immutable git checkout directory for an exact commit. */
export function gitArtifactCacheDir(
  dataDir: string,
  cachePath: string,
  commit: string,
): string {
  if (!isCommitSha(commit)) throw new Error(`invalid git commit "${commit}"`);
  return resolveInside(
    join(dataDir, "plugins", "cache", "git"),
    [...cachePath.split("/"), commit],
    "git artifact",
  );
}

/** Stable hash of names, kinds, link targets, and file bytes in a directory. */
export async function hashInstallDir(rootDir: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const name = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const stats = await lstat(path);
      if (stats.isDirectory()) {
        hash.update(`d\0${name}\0`);
        await visit(path, name);
      } else if (stats.isSymbolicLink()) {
        hash.update(`l\0${name}\0${await readlink(path)}\0`);
      } else if (stats.isFile()) {
        hash.update(`f\0${name}\0${stats.mode & 0o777}\0`);
        hash.update(await readFile(path));
      }
    }
  }
  await visit(rootDir, "");
  return `sha256:${hash.digest("hex")}`;
}

async function fsyncTree(rootDir: string): Promise<void> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(rootDir, entry.name);
    if (entry.isDirectory()) await fsyncTree(path);
    else if (entry.isFile()) {
      const handle = await open(path, constants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
  const handle = await open(rootDir, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Promote staged bytes into a never-overwritten cache path. EXDEV falls back
 * to a fully fsynced sibling copy followed by an atomic rename. An identical
 * target left by an interrupted attempt wins and the staging copy is dropped.
 */
export async function promoteImmutableDir(args: {
  stagingDir: string;
  targetDir: string;
  contentHash: string;
}): Promise<void> {
  await rm(`${args.targetDir}.promoting`, { recursive: true, force: true });
  const corruptDir = `${args.targetDir}.corrupt`;
  let movedCorruptTarget = false;
  try {
    if ((await hashInstallDir(args.targetDir)) === args.contentHash) {
      await rm(args.stagingDir, { recursive: true, force: true });
      return;
    }
    await rm(corruptDir, { recursive: true, force: true });
    await rename(args.targetDir, corruptDir);
    movedCorruptTarget = true;
  } catch {
    // Missing targets are the normal first-install case.
  }
  await rm(`${args.targetDir}.promoting`, { recursive: true, force: true });
  try {
    await rename(args.stagingDir, args.targetDir);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EXDEV") {
      if (movedCorruptTarget) await rename(corruptDir, args.targetDir);
      throw error;
    }
    const copyDir = `${args.targetDir}.promoting`;
    try {
      await cp(args.stagingDir, copyDir, { recursive: true, preserveTimestamps: true });
      await fsyncTree(copyDir);
      await rename(copyDir, args.targetDir);
      const parent = await open(dirname(args.targetDir), constants.O_RDONLY);
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      await rm(args.stagingDir, { recursive: true, force: true });
    } catch (copyError) {
      if (movedCorruptTarget) await rename(corruptDir, args.targetDir);
      throw copyError;
    } finally {
      await rm(copyDir, { recursive: true, force: true });
    }
  }
  if (movedCorruptTarget) {
    await rm(corruptDir, { recursive: true, force: true });
  }
}

/**
 * Promote a fully-materialized staging directory to its final location:
 * the previous install (if any) moves aside, the staging dir is renamed
 * into place, then the old copy is deleted. If the promotion rename fails,
 * the previous install is restored — a failed reinstall must never strand
 * a plugins row pointing at a deleted root.
 */
export async function swapDirIntoPlace(
  stagingDir: string,
  targetDir: string,
): Promise<void> {
  const previousDir = `${targetDir}.previous`;
  await rm(previousDir, { recursive: true, force: true });
  let hadPrevious = true;
  try {
    await rename(targetDir, previousDir);
  } catch {
    hadPrevious = false; // first install: nothing to move aside
  }
  try {
    await rename(stagingDir, targetDir);
  } catch (error) {
    if (hadPrevious) {
      try {
        await rename(previousDir, targetDir);
      } catch {
        // Restore failed too; the .previous dir is left for manual recovery.
      }
    }
    throw error;
  }
  if (hadPrevious) await rm(previousDir, { recursive: true, force: true });
}

export const INSTALL_COMMAND_TIMEOUT_MS = 5 * 60_000;

/**
 * Run a materialization command (git/npm), buffering output. Throws a clear
 * error when the binary is missing, the command times out, or it exits
 * non-zero (with the stderr tail — that is where git/npm explain themselves).
 */
export async function runInstallCommand(
  command: string,
  args: string[],
  options?: { timeoutMs?: number; notFoundHint?: string },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? INSTALL_COMMAND_TIMEOUT_MS;
  const child = spawnPortableOutputProcess({ command, args });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    if (stdout.length > 8192) stdout = stdout.slice(-8192);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 8192) stderr = stderr.slice(-8192);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(
          new Error(
            options?.notFoundHint ?? `"${command}" was not found on PATH`,
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const tail = stderr.trim().slice(-1000);
      reject(
        new Error(
          `${command} ${args[0]} failed (exit ${code ?? "signal"})${tail ? `: ${tail}` : ""}`,
        ),
      );
    });
  });
  return stdout.trim();
}
