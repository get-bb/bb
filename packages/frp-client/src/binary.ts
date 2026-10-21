import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { FRP_VERSION } from "@bb/tunnel-contract/next";
import { extractArchiveMember, type ArchiveFormat } from "./archive.js";

export const FRP_RELEASE_BASE_URL =
  "https://github.com/fatedier/frp/releases/download";

export const FRP_ARCHIVE_SHA256: Readonly<Record<string, string>> = {
  [`frp_${FRP_VERSION}_linux_amd64.tar.gz`]:
    "84f27e39f11169f7adcef8e8b70c9329de17747b1f14dad9fb95eef5682ea716",
  [`frp_${FRP_VERSION}_linux_arm64.tar.gz`]:
    "f33c293c275d8fc68c654b6fba8f10b2551d6463d09a9fc9cffb7227eae82266",
  [`frp_${FRP_VERSION}_darwin_amd64.tar.gz`]:
    "1b1b4e2f1836e21e8733f1dddaacd4ed9ae67d7dbee39046b9d7b7eda6253637",
  [`frp_${FRP_VERSION}_darwin_arm64.tar.gz`]:
    "45be02b186860d375ed49a8941ae9569628a54bf14e67fc36b29c98c99dabcc6",
  [`frp_${FRP_VERSION}_windows_amd64.zip`]:
    "9e5062e3e5cf07e67144a3a4acf175ef6a2486f3605dd6cf288bae34ab39819f",
  [`frp_${FRP_VERSION}_windows_arm64.zip`]:
    "b56a5c2a1a2a55d11bc27aeef6edabd39f3d194360ea66660cc27281b502cb1c",
};

const OPERATING_SYSTEMS: Readonly<Record<string, string>> = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
};

const ARCHITECTURES: Readonly<Record<string, string>> = {
  x64: "amd64",
  arm64: "arm64",
};

export type FrpTool = "frpc" | "frps";

export interface FrpArchive {
  fileName: string;
  url: string;
  sha256: string;
  format: ArchiveFormat;
  member: string;
  binaryName: string;
}

export type DownloadArchive = (url: string) => Promise<Uint8Array>;

export class FrpBinaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrpBinaryError";
  }
}

export function frpArchiveFor(
  platform: string,
  arch: string,
  tool: FrpTool = "frpc",
): FrpArchive {
  const os = OPERATING_SYSTEMS[platform];
  const cpu = ARCHITECTURES[arch];
  if (os === undefined || cpu === undefined) {
    throw new FrpBinaryError(`frp has no client for ${platform}/${arch}`);
  }
  const format: ArchiveFormat = os === "windows" ? "zip" : "tar.gz";
  const folder = `frp_${FRP_VERSION}_${os}_${cpu}`;
  const fileName = `${folder}.${format}`;
  const sha256 = FRP_ARCHIVE_SHA256[fileName];
  if (sha256 === undefined) {
    throw new FrpBinaryError(`no pinned checksum for ${fileName}`);
  }
  const binaryName = os === "windows" ? `${tool}.exe` : tool;
  return {
    fileName,
    url: `${FRP_RELEASE_BASE_URL}/v${FRP_VERSION}/${fileName}`,
    sha256,
    format,
    member: `${folder}/${binaryName}`,
    binaryName,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyFrpArchive(archive: FrpArchive, bytes: Uint8Array): void {
  const actual = sha256Hex(bytes);
  if (actual !== archive.sha256) {
    throw new FrpBinaryError(
      `${archive.fileName} does not match its pinned sha256 (got ${actual}), so bb will not run it`,
    );
  }
}

export const fetchArchive: DownloadArchive = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new FrpBinaryError(
      `downloading ${url} answered HTTP ${response.status}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
};

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export interface InstallFrpOptions {
  dir: string;
  platform: string;
  arch: string;
  tool?: FrpTool;
  download?: DownloadArchive;
}

export async function installFrp(options: InstallFrpOptions): Promise<string> {
  const archive = frpArchiveFor(options.platform, options.arch, options.tool);
  const target = path.join(options.dir, archive.binaryName);
  if (await exists(target)) return target;
  const bytes = await (options.download ?? fetchArchive)(archive.url);
  verifyFrpArchive(archive, bytes);
  const binary = extractArchiveMember(bytes, archive.format, archive.member);
  await fs.mkdir(options.dir, { recursive: true, mode: 0o700 });
  const staging = path.join(
    options.dir,
    `.${archive.binaryName}.${randomUUID()}`,
  );
  try {
    await fs.writeFile(staging, binary, { mode: 0o755 });
    await fs.chmod(staging, 0o755);
    await fs.rename(staging, target);
  } finally {
    await fs.rm(staging, { force: true });
  }
  return target;
}

export interface ResolveFrpcOptions {
  dataDir: string;
  env: NodeJS.ProcessEnv;
  platform?: string;
  arch?: string;
  download?: DownloadArchive;
}

export const FRPC_OVERRIDE_ENV = "BB_CONNECT_FRPC";

export function frpInstallDir(dataDir: string): string {
  return path.join(dataDir, "frp", FRP_VERSION);
}

export async function resolveFrpc(
  options: ResolveFrpcOptions,
): Promise<string> {
  const override = options.env[FRPC_OVERRIDE_ENV];
  if (override !== undefined && override !== "") {
    if (!(await exists(override))) {
      throw new FrpBinaryError(
        `${FRPC_OVERRIDE_ENV} names ${override}, which does not exist`,
      );
    }
    return override;
  }
  return installFrp({
    dir: frpInstallDir(options.dataDir),
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
    tool: "frpc",
    ...(options.download === undefined ? {} : { download: options.download }),
  });
}
