import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import {
  type ProviderInstallationCommand,
  experimental_compareVersions as compareVersions,
  experimental_formatCommand as formatCommand,
  experimental_versionFrom as versionFrom,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const PI_PACKAGE_SEGMENTS = ["@earendil-works", "pi-coding-agent"] as const;
const PI_PACKAGE_NAME = PI_PACKAGE_SEGMENTS.join("/");
const PI_MINIMUM_NODE_VERSION = "22.19.0";
const BUNDLED_PREFIX_DIR_NAME = "pi-npm-global";
const LATEST_VERSION_TIMEOUT_MS = 15_000;
const PI_BOOTSTRAP_SOURCE =
  "delete process.env.ELECTRON_RUN_AS_NODE;import(require('node:url').pathToFileURL(process.argv[1]).href)";
const NPM_BOOTSTRAP_SOURCE = [
  "const fs=require('node:fs'),path=require('node:path');",
  "const [prefix,npmCli,...rest]=process.argv.slice(1);",
  "const shim=path.join(prefix,'.bb-node-shim');",
  "fs.mkdirSync(shim,{recursive:true});",
  "process.env.PI_BB_NODE_RUNTIME=process.execPath;",
  "if(process.platform==='win32'){fs.writeFileSync(path.join(shim,'node.cmd'),'@echo off\\r\\nsetlocal\\r\\nset \"ELECTRON_RUN_AS_NODE=1\"\\r\\n\"%PI_BB_NODE_RUNTIME%\" %*\\r\\n');}",
  "else{const f=path.join(shim,'node');fs.writeFileSync(f,'#!/bin/sh\\nELECTRON_RUN_AS_NODE=1 exec \"$PI_BB_NODE_RUNTIME\" \"$@\"\\n');fs.chmodSync(f,0o755);}",
  "const key=Object.keys(process.env).find(k=>k.toUpperCase()==='PATH')||'PATH';",
  "process.env[key]=shim+path.delimiter+(process.env[key]||'');",
  "process.argv=[process.execPath,npmCli,...rest];",
  "require(npmCli);",
].join("");

const piPackageSchema = z.object({
  bin: z.union([z.string().min(1), z.object({ pi: z.string().min(1) })]),
});

interface PiBundledRuntime {
  prefix: string;
  npmCli: string | null;
}

let bundledRuntime: PiBundledRuntime | null = null;

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function resolveBundledNpmCliFrom(
  entryPath: string | undefined,
): string | null {
  if (entryPath === undefined || !path.isAbsolute(entryPath)) return null;
  try {
    const npmPackageJson = createRequire(entryPath).resolve("npm/package.json");
    const cli = path.join(path.dirname(npmPackageJson), "bin", "npm-cli.js");
    return isFile(cli) ? cli : null;
  } catch {
    return null;
  }
}

export function configurePiBundledRuntime(args: {
  dataDir: string;
  npmCli: string | null;
}): void {
  bundledRuntime = {
    prefix: path.join(args.dataDir, BUNDLED_PREFIX_DIR_NAME),
    npmCli: args.npmCli,
  };
}

export function resetPiBundledRuntimeForTests(): void {
  bundledRuntime = null;
}

export function bbRuntimeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return process.versions.electron === undefined
    ? env
    : { ...env, ELECTRON_RUN_AS_NODE: "1" };
}

function bundledPackageDir(prefix: string): string {
  return process.platform === "win32"
    ? path.join(prefix, "node_modules", ...PI_PACKAGE_SEGMENTS)
    : path.join(prefix, "lib", "node_modules", ...PI_PACKAGE_SEGMENTS);
}

export function resolveBundledPiCli(): string | null {
  if (bundledRuntime === null) return null;
  const packageDir = bundledPackageDir(bundledRuntime.prefix);
  try {
    const pkg = piPackageSchema.parse(
      JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")),
    );
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.pi;
    const cli = path.resolve(packageDir, bin);
    const relative = path.relative(packageDir, cli);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return isFile(cli) ? cli : null;
  } catch {
    return null;
  }
}

export function bundledPiLaunch(cli: string): {
  command: string;
  args: string[];
} {
  return {
    command: process.execPath,
    args: ["-e", PI_BOOTSTRAP_SOURCE, cli],
  };
}

export function isBundledPiLaunch(launch: {
  command: string;
  args: string[];
}): boolean {
  return (
    launch.command === process.execPath &&
    launch.args[0] === "-e" &&
    launch.args[1] === PI_BOOTSTRAP_SOURCE
  );
}

function usableBundledNpm(): { prefix: string; npmCli: string } | null {
  if (bundledRuntime === null || bundledRuntime.npmCli === null) return null;
  if (compareVersions(process.versions.node, PI_MINIMUM_NODE_VERSION) < 0) {
    return null;
  }
  return { prefix: bundledRuntime.prefix, npmCli: bundledRuntime.npmCli };
}

export function bundledPiInstallCommand(): ProviderInstallationCommand | null {
  const runtime = usableBundledNpm();
  if (runtime === null) return null;
  const args = [
    "-e",
    NPM_BOOTSTRAP_SOURCE,
    runtime.prefix,
    runtime.npmCli,
    "install",
    "--global",
    "--prefix",
    runtime.prefix,
    "--no-audit",
    "--no-fund",
    `${PI_PACKAGE_NAME}@latest`,
  ];
  return {
    command: process.execPath,
    args,
    displayCommand: formatCommand(process.execPath, args),
  };
}

export async function bundledPiLatestVersion(): Promise<string | null> {
  const runtime = usableBundledNpm();
  if (runtime === null) return null;
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [runtime.npmCli, "view", PI_PACKAGE_NAME, "version"],
      { env: bbRuntimeEnv(process.env), timeout: LATEST_VERSION_TIMEOUT_MS },
    );
    return versionFrom(stdout);
  } catch {
    return null;
  }
}
