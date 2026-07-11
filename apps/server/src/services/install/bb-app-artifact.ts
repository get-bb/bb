import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";

const execFileAsync = promisify(execFile);

export interface BbAppArtifactService {
  getTarballPath(): Promise<string>;
  getVersion(): Promise<string>;
}

export interface BbAppArtifactCommandRunner {
  (command: string, args: readonly string[], cwd: string): Promise<string>;
}

export interface CreateBbAppArtifactServiceOptions {
  dataDir: string;
  commandRunner?: BbAppArtifactCommandRunner;
  protocolVersion?: number;
  serverEntryUrl?: string;
}

interface BbAppPackageJson {
  name: string;
  version: string;
}

interface BbAppArtifactMetadata {
  protocolVersion: number;
  version: string;
}

const pendingBuilds = new Map<string, Promise<string>>();

async function defaultCommandRunner(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const result = await execFileAsync(command, [...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

async function readBbAppPackageJson(
  packageRoot: string,
): Promise<BbAppPackageJson> {
  const parsed: unknown = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("name" in parsed) ||
    parsed.name !== "bb-app" ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`Expected a bb-app package at ${packageRoot}`);
  }
  return { name: parsed.name, version: parsed.version };
}

export interface ResolvedBbAppPackage {
  layout: "packaged" | "repo";
  packageJson: BbAppPackageJson;
  root: string;
}

/**
 * Locates the bb-app package by probing the layouts the server actually runs
 * from and validating each candidate's package.json, instead of trusting
 * NODE_ENV: a source checkout can run with a production env (CI integration
 * harness) and a packaged install always sits two levels above the server
 * entry. The layout also decides the build strategy — a repo checkout must
 * build bb-app before packing, a packaged install just packs itself.
 */
export async function resolveBbAppPackage(
  serverEntryUrl: string,
): Promise<ResolvedBbAppPackage> {
  const serverEntryDir = dirname(fileURLToPath(serverEntryUrl));
  const candidates: readonly { layout: "packaged" | "repo"; root: string }[] = [
    { layout: "packaged", root: resolve(serverEntryDir, "../..") },
    {
      layout: "repo",
      root: resolve(serverEntryDir, "../../../packages/bb-app"),
    },
  ];
  for (const candidate of candidates) {
    try {
      const packageJson = await readBbAppPackageJson(candidate.root);
      return { ...candidate, packageJson };
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(
    `Unable to locate the bb-app package from ${serverEntryDir}; tried ${candidates
      .map((candidate) => candidate.root)
      .join(", ")}`,
  );
}

function safeVersionFilePart(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]/gu, "_");
}

async function pathIsFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function createBbAppArtifactService(
  options: CreateBbAppArtifactServiceOptions,
): BbAppArtifactService {
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const serverEntryUrl = options.serverEntryUrl ?? import.meta.url;
  const cacheDir = join(options.dataDir, "install-cache");
  const protocolVersion =
    options.protocolVersion ?? HOST_DAEMON_PROTOCOL_VERSION;
  let resolvedPackagePromise: Promise<ResolvedBbAppPackage> | undefined;

  function getResolvedPackage(): Promise<ResolvedBbAppPackage> {
    resolvedPackagePromise ??= resolveBbAppPackage(serverEntryUrl);
    return resolvedPackagePromise;
  }

  async function buildTarball(): Promise<string> {
    const resolved = await getResolvedPackage();
    const { packageJson, root: packageRoot } = resolved;
    const tarballPath = join(
      cacheDir,
      `bb-app-${safeVersionFilePart(packageJson.version)}-protocol-${protocolVersion}.tgz`,
    );
    const metadataPath = `${tarballPath}.json`;
    let cachedMetadata: BbAppArtifactMetadata | null = null;
    try {
      const parsed: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "version" in parsed &&
        parsed.version === packageJson.version &&
        "protocolVersion" in parsed &&
        parsed.protocolVersion === protocolVersion
      ) {
        cachedMetadata = {
          version: parsed.version,
          protocolVersion: parsed.protocolVersion,
        };
      }
    } catch {
      cachedMetadata = null;
    }
    if (cachedMetadata && (await pathIsFile(tarballPath))) {
      return tarballPath;
    }

    await mkdir(cacheDir, { recursive: true });
    await Promise.all([
      rm(tarballPath, { force: true }),
      rm(metadataPath, { force: true }),
    ]);

    if (resolved.layout === "repo") {
      const repoRoot = resolve(packageRoot, "../..");
      await commandRunner(
        "pnpm",
        ["exec", "turbo", "run", "build", "--filter=bb-app"],
        repoRoot,
      );
    }

    const stdout = await commandRunner(
      "npm",
      ["pack", "--pack-destination", cacheDir],
      packageRoot,
    );
    const packedName = stdout.trim().split(/\r?\n/u).at(-1);
    if (!packedName) {
      throw new Error("npm pack did not report a tarball name");
    }
    const packedPath = join(cacheDir, packedName);
    await rename(packedPath, tarballPath);
    await writeFile(
      metadataPath,
      `${JSON.stringify({ version: packageJson.version, protocolVersion })}\n`,
      "utf8",
    );
    return tarballPath;
  }

  return {
    async getTarballPath(): Promise<string> {
      const version = (await getResolvedPackage()).packageJson.version;
      const tarballPath = join(
        cacheDir,
        `bb-app-${safeVersionFilePart(version)}-protocol-${protocolVersion}.tgz`,
      );
      const existing = pendingBuilds.get(tarballPath);
      if (existing) {
        return existing;
      }
      const build = buildTarball().finally(() => {
        pendingBuilds.delete(tarballPath);
      });
      pendingBuilds.set(tarballPath, build);
      return build;
    },
    async getVersion(): Promise<string> {
      return (await getResolvedPackage()).packageJson.version;
    },
  };
}
