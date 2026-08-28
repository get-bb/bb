import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const { mkdir, readFile, rename, rm } =
  process.getBuiltinModule("node:fs/promises");

export interface BbAppArtifactService {
  getTarballPath(): Promise<string>;
  getVersion(): Promise<string>;
}

export interface BbAppArtifactCommandRunner {
  (command: string, args: readonly string[], cwd: string): Promise<string>;
}

interface CreateBbAppArtifactServiceOptions {
  dataDir: string;
  commandRunner?: BbAppArtifactCommandRunner;
  protocolVersion?: number;
  serverEntryUrl?: string;
}

interface BbAppPackageJson {
  name: string;
  version: string;
}

const bbAppPackageJsonSchema: z.ZodType<BbAppPackageJson> = z.object({
  name: z.literal("bb-app"),
  version: z.string(),
});

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
  const parsed = bbAppPackageJsonSchema.safeParse(
    JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
  );
  if (!parsed.success) {
    throw new Error(`Expected a bb-app package at ${packageRoot}`);
  }
  return parsed.data;
}

interface ResolvedBbAppPackage {
  layout: "packaged" | "repo";
  packageJson: BbAppPackageJson;
  root: string;
}

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
    } catch {}
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

export function createBbAppArtifactService(
  options: CreateBbAppArtifactServiceOptions,
): BbAppArtifactService {
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const serverEntryUrl = options.serverEntryUrl ?? import.meta.url;
  const cacheDir = join(options.dataDir, "install-cache");
  const protocolVersion =
    options.protocolVersion ?? HOST_DAEMON_PROTOCOL_VERSION;
  let resolvedPackagePromise: Promise<ResolvedBbAppPackage> | undefined;
  let artifactPromise: Promise<string> | undefined;

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
    await mkdir(cacheDir, { recursive: true });
    await rm(`${tarballPath}.json`, { force: true });

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
    return tarballPath;
  }

  return {
    getTarballPath(): Promise<string> {
      artifactPromise ??= buildTarball().catch((error) => {
        artifactPromise = undefined;
        throw error;
      });
      return artifactPromise;
    },
    async getVersion(): Promise<string> {
      return (await getResolvedPackage()).packageJson.version;
    },
  };
}
