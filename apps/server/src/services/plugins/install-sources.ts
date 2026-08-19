import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import semver from "semver";
import {
  omitNpmScriptPolicyEnv,
  spawnPortableOutputProcess,
} from "@bb/process-utils";

/**
 * What a `git:` spec asks for.
 *
 * - "ref" is one branch, tag, or commit, classified later with ls-remote.
 * - "range" is a semver range resolved over `[tagPrefix]vX.Y.Z` tags.
 * - "ref-or-range" is the implicit form: the spec reads as a semver range,
 *   but a repository is free to name a branch `1.x`. Classification decides,
 *   and a spec that is both is refused rather than guessed. See
 *   {@link isGitSemverRangeSpec}.
 */
export type ParsedGitSelector =
  | { kind: "ref"; ref: string }
  | { kind: "range"; range: string; tagPrefix: string }
  | { kind: "ref-or-range"; ref: string; range: string };

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
      /** The spec as written after "@"; "HEAD" when it was omitted. */
      spec: string;
      selector: ParsedGitSelector;
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
/** Forces the rest of a git spec to read as a semver range: `semver:^1.2.0`. */
const GIT_RANGE_SPEC_PREFIX = "semver:";
/** Forces the rest of a git spec to read as a literal ref: `ref:1.x`. */
const GIT_REF_SPEC_PREFIX = "ref:";
/** `v1`, `1.2`, and `v1.2.3` are ordinary tag names, not ranges. */
const BARE_VERSION_SPEC_PATTERN = /^v?\d+(?:\.\d+)*$/u;
const GIT_TAG_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const MAX_GIT_TAG_PREFIX_LENGTH = 128;
// Loose npm package-name shape; enough to keep names safe as path segments.
const NPM_NAME_PATTERN = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
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

/**
 * Whether a git spec reads as a semver range rather than as a ref name.
 *
 * A bare version token is excluded: `v1`, `v1.2`, and `v1.2.3` all parse as
 * semver ranges, but they are how repositories actually name tags, so they
 * keep resolving as the literal tag. Write `semver:v1` to range over them.
 */
export function isGitSemverRangeSpec(spec: string): boolean {
  return (
    semver.validRange(spec) !== null &&
    semver.valid(spec) === null &&
    !BARE_VERSION_SPEC_PATTERN.test(spec)
  );
}

/**
 * Validate a monorepo tag prefix such as `thread-hover-cards/`, which
 * versions one plugin of a repository with `thread-hover-cards/vX.Y.Z` tags.
 * An empty prefix means repository-wide `vX.Y.Z` tags.
 */
export function normalizeGitTagPrefix(value: string): string {
  if (value.length === 0) return value;
  if (
    value.length > MAX_GIT_TAG_PREFIX_LENGTH ||
    !GIT_TAG_PREFIX_PATTERN.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.endsWith(".") ||
    value
      .split("/")
      .some((segment) => segment.startsWith(".") || segment.endsWith(".lock"))
  ) {
    throw new Error(`invalid git tag prefix "${value}"`);
  }
  return value;
}

/**
 * The canonical install spec for a semver range over tags. The explicit
 * `semver:` form never collides with a ref of the same name, so generated
 * specs (marketplace entries, `--tag-prefix`) always use it.
 */
export function gitRangeSourceSpec(args: {
  url: string;
  range: string;
  tagPrefix: string;
}): string {
  const prefix =
    args.tagPrefix.length === 0
      ? ""
      : `${normalizeGitTagPrefix(args.tagPrefix)}:`;
  return `git:${args.url}@${GIT_RANGE_SPEC_PREFIX}${prefix}${args.range}`;
}

/** The tag a released `version` carries under `tagPrefix`. */
export function gitSemverTagName(tagPrefix: string, version: string): string {
  return `${tagPrefix}v${version}`;
}

/**
 * The release a tag names under `tagPrefix`, or null when the tag is not a
 * `[tagPrefix]vX.Y.Z` release tag. The version must be canonical semver, so
 * `v1.2` and `v1.2.3+build` are not releases of this scheme.
 */
export function gitSemverTagVersion(
  tag: string,
  tagPrefix: string,
): string | null {
  if (!tag.startsWith(tagPrefix)) return null;
  const rest = tag.slice(tagPrefix.length);
  if (!rest.startsWith("v")) return null;
  const version = rest.slice(1);
  return semver.parse(version)?.version === version ? version : null;
}

function parseGitSelector(spec: string): ParsedGitSelector {
  if (spec.startsWith(GIT_REF_SPEC_PREFIX)) {
    const ref = spec.slice(GIT_REF_SPEC_PREFIX.length);
    if (ref.length === 0) throw new Error("git source has an empty ref");
    return { kind: "ref", ref };
  }
  if (spec.startsWith(GIT_RANGE_SPEC_PREFIX)) {
    // "semver:<range>" or "semver:<tagPrefix>:<range>". Neither a range nor a
    // ref name can contain ":", so the split is unambiguous.
    const parts = spec.slice(GIT_RANGE_SPEC_PREFIX.length).split(":");
    if (parts.length > 2) {
      throw new Error(`invalid git semver spec "${spec}"`);
    }
    const range = parts[parts.length - 1] ?? "";
    const tagPrefix = normalizeGitTagPrefix(
      parts.length === 2 ? (parts[0] ?? "") : "",
    );
    if (semver.validRange(range) === null) {
      throw new Error(`invalid git semver range "${range}"`);
    }
    return { kind: "range", range, tagPrefix };
  }
  // Git ref names cannot contain ":", so the only specs that legitimately
  // carry one are the selector prefixes handled above.
  if (spec.includes(":")) {
    throw new Error(
      `invalid git spec "${spec}" — use "ref:<name>" or "semver:[<tagPrefix>:]<range>"`,
    );
  }
  return isGitSemverRangeSpec(spec)
    ? { kind: "ref-or-range", ref: spec, range: spec }
    : { kind: "ref", ref: spec };
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
  const selector = parseGitSelector(ref);
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
    spec: ref,
    selector,
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

/**
 * Normalize a nested-plugin selector to a POSIX relative path inside a
 * repository. A leading "./" is accepted; absolute paths, backslashes, empty
 * segments, "." and ".." are rejected. The repository root itself is never a
 * nested plugin, so a selector that normalizes to nothing is rejected too.
 */
export function normalizePluginSubdirectory(value: string): string {
  const trimmed = value.startsWith("./") ? value.slice(2) : value;
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    /^[a-zA-Z]:/.test(trimmed)
  ) {
    throw new Error(`invalid plugin subdirectory "${value}"`);
  }
  assertSafeSegments(trimmed, "plugin subdirectory");
  if (trimmed.split("/").includes(".git")) {
    throw new Error(`invalid plugin subdirectory "${value}"`);
  }
  return trimmed;
}

/**
 * Plugin roots that live inside `root`, as paths relative to it. Ancestors
 * win: moving a directory moves everything under it, so a root nested inside
 * another preserved root is dropped. `root` itself is never returned.
 */
export function nestedPluginRoots(root: string, paths: string[]): string[] {
  const relatives = paths
    .map((path) => relative(root, path))
    .filter(
      (path) =>
        path.length > 0 && path !== ".." && !path.startsWith(`..${sep}`),
    )
    .sort((left, right) => left.length - right.length);
  const kept: string[] = [];
  for (const candidate of relatives) {
    if (kept.includes(candidate)) continue;
    if (kept.some((parent) => candidate.startsWith(`${parent}${sep}`))) {
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}

/** Plugin root inside a checkout: the checkout itself for a root install. */
export function pluginRootDir(
  checkoutDir: string,
  subdirectory: string | null,
): string {
  return subdirectory === null
    ? checkoutDir
    : join(checkoutDir, ...subdirectory.split("/"));
}

/** Managed npm install prefix; the plugin root is <prefix>/node_modules/<name>. */
export function npmInstallPrefix(
  dataDir: string,
  name: string,
  version: string,
): string {
  return join(dataDir, "plugins", "npm", ...`${name}@${version}`.split("/"));
}

function resolveInside(
  root: string,
  segments: string[],
  label: string,
): string {
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
  allowRoot = false,
): Promise<string> {
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target),
  ]);
  const fromRoot = relative(realRoot, realTarget);
  if (fromRoot === "" && !allowRoot) {
    throw new Error(`${label} resolves to its root`);
  }
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
}

/** Restore or clean the backup left by a process stop during promotion. */
export async function recoverInterruptedGitPluginPromotion(
  targetDir: string,
): Promise<void> {
  const corruptDir = `${targetDir}.corrupt`;
  const promotingDir = `${targetDir}.promoting`;
  const corruptExists = await pathExists(corruptDir);
  if (!corruptExists) {
    await rm(promotingDir, { recursive: true, force: true });
    return;
  }
  const targetExists = await pathExists(targetDir);
  if (targetExists) {
    await rm(corruptDir, { recursive: true, force: true });
  } else {
    await mkdir(dirname(targetDir), { recursive: true });
    await rename(corruptDir, targetDir);
  }
  await rm(promotingDir, { recursive: true, force: true });
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
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EXDEV"
    ) {
      if (movedCorruptTarget) await rename(corruptDir, args.targetDir);
      throw error;
    }
    const copyDir = `${args.targetDir}.promoting`;
    try {
      await cp(args.stagingDir, copyDir, {
        recursive: true,
        preserveTimestamps: true,
      });
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
 * Promote a git plugin from its staged checkout into the repo+commit cache.
 *
 * One checkout serves every plugin of a multi-plugin repository, so a promote
 * must never replace a tree another plugin already built into. Only the
 * selected plugin root moves, and copies of the built trees that live inside
 * that root ride along from the target. Copying leaves the live checkout whole
 * until the final promotion if the process stops during preservation. The
 * content hash covers the plugin root alone for the same reason.
 *
 * Returns the content hash of the promoted plugin root, which differs from
 * the staged hash when a nested plugin was carried over.
 */
export async function promoteGitPluginArtifact(args: {
  stagingDir: string;
  targetDir: string;
  subdirectory: string | null;
  contentHash: string;
  /**
   * Plugin roots inside this plugin's root, relative to it, whose built files
   * belong to another plugin. See `nestedPluginRoots`.
   */
  preserveNestedRoots: string[];
}): Promise<string> {
  const targetExists = await stat(args.targetDir)
    .then(() => true)
    .catch(() => false);
  if (!targetExists) {
    await promoteImmutableDir({
      stagingDir: args.stagingDir,
      targetDir: args.targetDir,
      contentHash: args.contentHash,
    });
    return args.contentHash;
  }
  // A selected path can be an in-repository symlink. Move the directory that
  // validation built, not the symlink whose target the staging cleanup removes.
  const stagingRoot = await realPathInside(
    args.stagingDir,
    pluginRootDir(args.stagingDir, args.subdirectory),
    "git plugin subdirectory",
    args.subdirectory === null,
  );
  const targetRoot = pluginRootDir(args.targetDir, args.subdirectory);
  let preservedCount = 0;
  try {
    // An identical target is settled before anything moves: `promoteImmutableDir`
    // drops the staging tree in that case, and the carried-over plugins are in
    // it by then.
    if (
      (await hashInstallDir(targetRoot).catch(() => null)) === args.contentHash
    ) {
      await rm(args.stagingDir, { recursive: true, force: true });
      return args.contentHash;
    }
    // Garbage collection of a nested plugin can leave its parent directories
    // behind or empty, so the plugin root of a reinstall needs one.
    await mkdir(dirname(targetRoot), { recursive: true });
    for (const nested of args.preserveNestedRoots) {
      const from = join(targetRoot, nested);
      const exists = await stat(from)
        .then(() => true)
        .catch(() => false);
      if (!exists) continue;
      const to = join(stagingRoot, nested);
      await rm(to, { recursive: true, force: true });
      const resolvedFrom = await realPathInside(
        args.targetDir,
        from,
        "nested git plugin root",
      );
      await cp(resolvedFrom, to, {
        recursive: true,
        preserveTimestamps: true,
      });
      preservedCount += 1;
    }
    await promoteImmutableDir({
      stagingDir: stagingRoot,
      targetDir: targetRoot,
      contentHash: args.contentHash,
    });
  } finally {
    await rm(args.stagingDir, { recursive: true, force: true });
  }
  return preservedCount === 0
    ? args.contentHash
    : await hashInstallDir(targetRoot);
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
  options?: {
    timeoutMs?: number;
    notFoundHint?: string;
    /**
     * Keep the whole output up to this size and fail past it, for commands
     * whose full stdout is parsed. Without it only the last 8 KB survives,
     * which is enough to explain a failure but not to read a tag listing.
     */
    maxStdoutBytes?: number;
  },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? INSTALL_COMMAND_TIMEOUT_MS;
  const child = spawnPortableOutputProcess({
    command,
    args,
    env: omitNpmScriptPolicyEnv(process.env),
  });
  let stderr = "";
  let stdout = "";
  let stdoutBytes = 0;
  let overflowed = false;
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    stdoutBytes += chunk.byteLength;
    const limit = options?.maxStdoutBytes;
    if (limit === undefined) {
      if (stdout.length > 8192) stdout = stdout.slice(-8192);
    } else if (stdoutBytes > limit && !overflowed) {
      overflowed = true;
      child.kill("SIGKILL");
    }
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
      if (overflowed) {
        reject(
          new Error(
            `${command} ${args[0]} produced more than ${options?.maxStdoutBytes} bytes of output`,
          ),
        );
        return;
      }
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
