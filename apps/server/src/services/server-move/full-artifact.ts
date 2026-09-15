import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  resolveBbAppPackage,
  type BbAppArtifactCommandRunner,
} from "../install/bb-app-artifact.js";

const execFileAsync = promisify(execFile);
const REQUIRED_PACKAGE_PATHS = [
  "dist/bb-server.js",
  "dist/bb-app.js",
  "server/dist",
  "app/dist",
] as const;
const PACKAGE_SIZE_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
]);

export interface FullBbAppArtifact {
  path: string;
  sha256: string;
  sizeBytes: number;
  version: string;
}

export type FullBbAppArtifactAvailability =
  | { available: true; unpackedSizeBytes: number; version: string }
  | { available: false; reason: string };

export interface FullBbAppArtifactService {
  availability(): Promise<FullBbAppArtifactAvailability>;
  build(): Promise<FullBbAppArtifact>;
}

export interface CreateFullBbAppArtifactServiceArgs {
  commandRunner: BbAppArtifactCommandRunner;
  dataDir: string;
  serverEntryUrl: string;
}

export const runPackCommand: BbAppArtifactCommandRunner = async (
  command,
  args,
  cwd,
) => {
  const result = await execFileAsync(command, [...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function packageSizeBytes(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!PACKAGE_SIZE_SKIPPED_DIRECTORIES.has(entry.name)) {
        total += await packageSizeBytes(path);
      }
      continue;
    }
    if (entry.isFile()) {
      total += (await stat(path)).size;
    }
  }
  return total;
}

export function createFullBbAppArtifactService(
  args: CreateFullBbAppArtifactServiceArgs,
): FullBbAppArtifactService {
  const cacheDir = join(args.dataDir, "install-cache");
  let artifactPromise: Promise<FullBbAppArtifact> | undefined;
  let packageSize:
    | { root: string; version: string; sizeBytes: number }
    | undefined;

  async function packagedSizeBytes(
    root: string,
    version: string,
  ): Promise<number> {
    if (packageSize?.root !== root || packageSize.version !== version) {
      packageSize = { root, version, sizeBytes: await packageSizeBytes(root) };
    }
    return packageSize.sizeBytes;
  }

  async function resolvePackagedRoot(): Promise<
    | { available: true; root: string; version: string }
    | { available: false; reason: string }
  > {
    let resolved: Awaited<ReturnType<typeof resolveBbAppPackage>>;
    try {
      resolved = await resolveBbAppPackage(args.serverEntryUrl);
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (resolved.layout === "repo") {
      return {
        available: false,
        reason:
          "This server runs from a source checkout, so it can't send its full bb-app package.",
      };
    }
    for (const relativePath of REQUIRED_PACKAGE_PATHS) {
      if (!(await pathExists(join(resolved.root, relativePath)))) {
        return {
          available: false,
          reason: `The installed bb-app package is missing ${relativePath}.`,
        };
      }
    }
    return {
      available: true,
      root: resolved.root,
      version: resolved.packageJson.version,
    };
  }

  async function buildArtifact(): Promise<FullBbAppArtifact> {
    const resolved = await resolvePackagedRoot();
    if (!resolved.available) {
      throw new Error(resolved.reason);
    }
    await mkdir(cacheDir, { recursive: true });
    const stdout = await args.commandRunner(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", cacheDir],
      resolved.root,
    );
    const packedName = stdout.trim().split(/\r?\n/u).at(-1);
    if (!packedName) {
      throw new Error("npm pack did not report a tarball name");
    }
    const packedPath = join(cacheDir, packedName);
    const sha256 = await sha256File(packedPath);
    const artifactPath = join(
      cacheDir,
      `bb-app-full-${resolved.version}-${sha256}.tgz`,
    );
    await rename(packedPath, artifactPath);
    const artifactStats = await stat(artifactPath);
    return {
      path: artifactPath,
      sha256,
      sizeBytes: artifactStats.size,
      version: resolved.version,
    };
  }

  return {
    async availability() {
      const resolved = await resolvePackagedRoot();
      if (!resolved.available) {
        return resolved;
      }
      return {
        available: true,
        unpackedSizeBytes: await packagedSizeBytes(
          resolved.root,
          resolved.version,
        ),
        version: resolved.version,
      };
    },
    build() {
      artifactPromise ??= buildArtifact().catch((error: unknown) => {
        artifactPromise = undefined;
        throw error;
      });
      return artifactPromise;
    },
  };
}
