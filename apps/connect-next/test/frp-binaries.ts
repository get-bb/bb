import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { FRP_VERSION } from "@bb/tunnel-contract/next";

const run = promisify(execFile);
const RELEASES = "https://github.com/fatedier/frp/releases/download";
const ARCHIVES: Record<string, [name: string, sha256: string]> = {
  "linux-x64": [
    "linux_amd64",
    "84f27e39f11169f7adcef8e8b70c9329de17747b1f14dad9fb95eef5682ea716",
  ],
  "linux-arm64": [
    "linux_arm64",
    "f33c293c275d8fc68c654b6fba8f10b2551d6463d09a9fc9cffb7227eae82266",
  ],
  "darwin-arm64": [
    "darwin_arm64",
    "45be02b186860d375ed49a8941ae9569628a54bf14e67fc36b29c98c99dabcc6",
  ],
  "darwin-x64": [
    "darwin_amd64",
    "1b1b4e2f1836e21e8733f1dddaacd4ed9ae67d7dbee39046b9d7b7eda6253637",
  ],
};

export interface FrpBinaries {
  frps: string;
  frpc: string;
}

export type FrpAvailability =
  | { ok: true; binaries: FrpBinaries }
  | { ok: false; reason: string };

async function exists(path: string): Promise<boolean> {
  return fs.access(path).then(
    () => true,
    () => false,
  );
}

async function download(dir: string): Promise<FrpBinaries> {
  const frps = join(dir, "frps");
  const frpc = join(dir, "frpc");
  if ((await exists(frps)) && (await exists(frpc))) return { frps, frpc };
  const platform = `${process.platform}-${process.arch}`;
  const archive = ARCHIVES[platform];
  if (archive === undefined) {
    throw new Error(`there is no frp ${FRP_VERSION} build for ${platform}`);
  }
  const [name, sha256] = archive;
  const folder = `frp_${FRP_VERSION}_${name}`;
  const response = await fetch(`${RELEASES}/v${FRP_VERSION}/${folder}.tar.gz`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`the frp download answered HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== sha256) {
    throw new Error(`the frp download has sha256 ${digest}, not ${sha256}`);
  }
  await fs.mkdir(dir, { recursive: true });
  const staging = await fs.mkdtemp(join(dir, "staging-"));
  const packed = join(staging, `${folder}.tar.gz`);
  await fs.writeFile(packed, bytes);
  await run("tar", [
    "-xzf",
    packed,
    "-C",
    staging,
    "--strip-components=1",
    `${folder}/frps`,
    `${folder}/frpc`,
  ]);
  for (const binary of ["frps", "frpc"]) {
    await fs.chmod(join(staging, binary), 0o755);
    await fs.rename(join(staging, binary), join(dir, binary));
  }
  await fs.rm(staging, { recursive: true, force: true });
  return { frps, frpc };
}

let pending: Promise<FrpAvailability> | null = null;

export function frpBinaries(): Promise<FrpAvailability> {
  pending ??= download(join(homedir(), ".cache", "bb-frp", FRP_VERSION)).then(
    (binaries): FrpAvailability => ({ ok: true, binaries }),
    (error: unknown): FrpAvailability => ({
      ok: false,
      reason: `frp ${FRP_VERSION} is not available (offline?): ${String(error)}`,
    }),
  );
  return pending;
}
