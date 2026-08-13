import { spawn } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { constants } from "node:fs";

export interface ToolchainReport {
  found: Array<{ id: string; version: string; path: string }>;
  missing: Array<{ id: string; unlocks: "build" | "flash" }>;
  configured: boolean;
}

export interface ToolchainProbe {
  id: string;
  binary: string;
  versionArgs: readonly string[];
  unlocks: "build" | "flash";
  parse(output: string): string | null;
}

export interface ToolchainContext {
  /** Stable per-plugin holder; production uses the plugin database handle. */
  cacheKey: object;
  path: string;
  probes: readonly ToolchainProbe[];
  probeTimeoutMs: number;
}

export const DEFAULT_TOOLCHAIN_PROBES: readonly ToolchainProbe[] = [
  {
    id: "arm-none-eabi-gcc",
    binary: "arm-none-eabi-gcc",
    versionArgs: ["--version"],
    unlocks: "build",
    parse: firstVersionLine,
  },
  {
    id: "cmake",
    binary: "cmake",
    versionArgs: ["--version"],
    unlocks: "build",
    parse: firstVersionLine,
  },
  {
    id: "ninja",
    binary: "ninja",
    versionArgs: ["--version"],
    unlocks: "build",
    parse: semanticVersion,
  },
  {
    id: "west",
    binary: "west",
    versionArgs: ["--version"],
    unlocks: "build",
    parse: firstVersionLine,
  },
  {
    id: "openocd",
    binary: "openocd",
    versionArgs: ["--version"],
    unlocks: "flash",
    parse: firstVersionLine,
  },
] as const;

const cache = new WeakMap<object, Promise<ToolchainReport>>();
const MAX_VERSION_BYTES = 64 * 1024;

function firstVersionLine(output: string): string | null {
  const line = output.split(/\r?\n/u).map((value) => value.trim()).find(Boolean);
  return line && line.length <= 1000 ? line : null;
}

function semanticVersion(output: string): string | null {
  const match = /^\s*(\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?)\s*$/u.exec(output);
  return match?.[1] ?? null;
}

function validateContext(ctx: ToolchainContext): void {
  if (!Number.isInteger(ctx.probeTimeoutMs) || ctx.probeTimeoutMs < 50 || ctx.probeTimeoutMs > 30_000) {
    throw new Error("Toolchain probe timeout must be between 50 and 30000 ms");
  }
  if (ctx.path.includes("\0")) throw new Error("Toolchain PATH is invalid");
  const ids = new Set<string>();
  for (const probe of ctx.probes) {
    if (!/^[a-z0-9][a-z0-9._+-]{0,100}$/u.test(probe.id) || ids.has(probe.id)) {
      throw new Error(`Invalid or duplicate toolchain probe id ${probe.id}`);
    }
    ids.add(probe.id);
    if (
      probe.binary.includes("/") ||
      probe.binary.includes("\\") ||
      probe.binary.length === 0 ||
      probe.versionArgs.length > 16 ||
      probe.versionArgs.some((arg) => arg.length > 1000 || arg.includes("\0"))
    ) {
      throw new Error(`Invalid toolchain probe command for ${probe.id}`);
    }
  }
}

export async function resolveExecutable(binary: string, pathValue: string): Promise<string | null> {
  if (binary.includes("\0") || pathValue.includes("\0")) return null;
  const candidates = isAbsolute(binary)
    ? [binary]
    : binary.includes("/") || binary.includes("\\")
      ? []
      : pathValue
          .split(delimiter)
          .filter((entry) => isAbsolute(entry))
          .map((entry) => join(entry, binary));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      const resolved = await realpath(candidate);
      if ((await stat(resolved)).isFile()) return resolved;
    } catch {
      // A missing or non-executable probe is an unconfigured capability.
    }
  }
  return null;
}

async function captureVersion(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string | null> {
  return await new Promise((resolve) => {
    const child = spawn(executable, args, {
      env: { LANG: "C", LC_ALL: "C", PATH: "" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let overflow = false;
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const collect = (chunk: Buffer): void => {
      if (overflow) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > MAX_VERSION_BYTES) {
        overflow = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, timeoutMs);
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      finish(code === 0 && !overflow ? output : null);
    });
  });
}

async function probeToolchains(ctx: ToolchainContext): Promise<ToolchainReport> {
  validateContext(ctx);
  const found: ToolchainReport["found"] = [];
  const missing: ToolchainReport["missing"] = [];
  for (const probe of ctx.probes) {
    const executable = await resolveExecutable(probe.binary, ctx.path);
    if (executable === null) {
      missing.push({ id: probe.id, unlocks: probe.unlocks });
      continue;
    }
    const output = await captureVersion(executable, probe.versionArgs, ctx.probeTimeoutMs);
    const version = output === null ? null : probe.parse(output);
    if (version === null) {
      missing.push({ id: probe.id, unlocks: probe.unlocks });
      continue;
    }
    found.push({ id: probe.id, version, path: executable });
  }
  return {
    found,
    missing,
    configured: found.length > 0 && missing.length === 0,
  };
}

export function detectToolchains(ctx: ToolchainContext): Promise<ToolchainReport> {
  const existing = cache.get(ctx.cacheKey);
  if (existing) return existing;
  const pending = probeToolchains(ctx).catch((error: unknown) => {
    cache.delete(ctx.cacheKey);
    throw error;
  });
  cache.set(ctx.cacheKey, pending);
  return pending;
}

export function redetectToolchains(ctx: ToolchainContext): Promise<ToolchainReport> {
  cache.delete(ctx.cacheKey);
  return detectToolchains(ctx);
}
