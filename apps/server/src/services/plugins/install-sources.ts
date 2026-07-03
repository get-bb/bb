import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { spawnPortableOutputProcess } from "@bb/process-utils";

/**
 * Parsed `bb plugin install` source spec (design §6). The spec string is
 * stored verbatim on the plugins row; parsing is repeated at remove time to
 * find the managed directory for git:/npm: sources.
 */
export type ParsedPluginSource =
  | { kind: "path"; path: string }
  | {
      kind: "git";
      /** Clone URL (https, or an on-disk repo path). */
      url: string;
      /** Pinned ref — branch, tag, or commit sha. Always required. */
      ref: string;
      /** Managed dir relative to <dataDir>/plugins/git: "<host>/<path>@<ref>". */
      installDir: string;
    }
  | { kind: "npm"; name: string; version: string };

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
// Loose npm package-name shape; enough to keep names safe as path segments.
const NPM_NAME_PATTERN =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

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
  if (at <= 0 || at === spec.length - 1) {
    throw new Error(
      "git installs must pin a ref: git:<url>@<ref> (branch, tag, or commit sha)",
    );
  }
  const urlish = spec.slice(0, at);
  const ref = spec.slice(at + 1);
  if (ref.startsWith("-") || ref.includes("..")) {
    throw new Error(`invalid git ref "${ref}"`);
  }
  let url: string;
  let host: string;
  let repoPath: string;
  if (/^https?:\/\//.test(urlish)) {
    const parsed = new URL(urlish);
    url = urlish;
    host = parsed.host;
    repoPath = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
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
  return { kind: "git", url, ref, installDir: `${host}/${repoPath}@${ref}` };
}

function parseNpmSource(spec: string): ParsedPluginSource {
  const at = spec.lastIndexOf("@");
  if (at <= 0 || at === spec.length - 1) {
    throw new Error(
      "npm installs must pin an exact version: npm:<name>@<version>",
    );
  }
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (!NPM_NAME_PATTERN.test(name)) {
    throw new Error(`invalid npm package name "${name}"`);
  }
  if (semver.valid(version) === null) {
    throw new Error(
      `npm installs must pin an exact version, got "${version}" — ranges and tags are not allowed`,
    );
  }
  return { kind: "npm", name, version };
}

/** Parse an install source spec. Bare strings are treated as local paths. */
export function parsePluginSource(source: string): ParsedPluginSource {
  if (source.startsWith("git:")) return parseGitSource(source.slice(4));
  if (source.startsWith("npm:")) return parseNpmSource(source.slice(4));
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

/**
 * The directory `remove` must delete for a managed (git:/npm:) source, or
 * undefined for path: sources (never delete a user's own directory).
 */
export function managedInstallDir(
  dataDir: string,
  source: string,
): string | undefined {
  let parsed: ParsedPluginSource;
  try {
    parsed = parsePluginSource(source);
  } catch {
    return undefined;
  }
  if (parsed.kind === "git") {
    return join(dataDir, "plugins", "git", ...parsed.installDir.split("/"));
  }
  if (parsed.kind === "npm") {
    return npmInstallPrefix(dataDir, parsed.name, parsed.version);
  }
  return undefined;
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
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? INSTALL_COMMAND_TIMEOUT_MS;
  const child = spawnPortableOutputProcess({ command, args });
  let stderr = "";
  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 8192) stderr = stderr.slice(-8192);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`${command} ${args[0]} timed out after ${timeoutMs}ms`),
      );
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
}
