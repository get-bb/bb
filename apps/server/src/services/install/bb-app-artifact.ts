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
  isDevelopment: boolean;
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

export function resolveBbAppPackageRoot(args: {
  isDevelopment: boolean;
  serverEntryUrl: string;
}): string {
  const serverEntryDir = dirname(fileURLToPath(args.serverEntryUrl));
  return args.isDevelopment
    ? resolve(serverEntryDir, "../../../packages/bb-app")
    : resolve(serverEntryDir, "../..");
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
  const packageRoot = resolveBbAppPackageRoot({
    isDevelopment: options.isDevelopment,
    serverEntryUrl: options.serverEntryUrl ?? import.meta.url,
  });
  const cacheDir = join(options.dataDir, "install-cache");
  const protocolVersion =
    options.protocolVersion ?? HOST_DAEMON_PROTOCOL_VERSION;
  let packageJsonPromise: Promise<BbAppPackageJson> | undefined;

  function getPackageJson(): Promise<BbAppPackageJson> {
    packageJsonPromise ??= readBbAppPackageJson(packageRoot);
    return packageJsonPromise;
  }

  async function buildTarball(): Promise<string> {
    const packageJson = await getPackageJson();
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

    if (options.isDevelopment) {
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
      const version = (await getPackageJson()).version;
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
      return (await getPackageJson()).version;
    },
  };
}
