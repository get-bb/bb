import { spawn, type ChildProcess } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { constants } from "node:fs";

export interface ToolchainReport {
  found: Array<{ id: string; version: string; path: string }>;
  missing: Array<{ id: string; unlocks: ToolchainCapability }>;
  configured: boolean;
}

export type ToolchainCapability = "build" | "flash" | "zephyr-workspace";

export interface ToolchainProbe {
  id: string;
  binary: string;
  versionArgs: readonly string[];
  unlocks: ToolchainCapability;
  parse(output: string): string | null;
}

export interface ToolchainContext {
  /** Stable per-plugin holder; production uses the plugin database handle. */
  cacheKey: object;
  path: string;
  probes: readonly ToolchainProbe[];
  probeTimeoutMs: number;
  signal: AbortSignal;
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
    unlocks: "zephyr-workspace",
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

const cache = new WeakMap<object, Map<string, Promise<ToolchainReport>>>();
const MAX_VERSION_BYTES = 64 * 1024;
const CAPABILITIES = ["build", "flash", "zephyr-workspace"] as const;

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

function killProbeTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // The probe may have exited between the timeout/abort and the signal.
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
  signal: AbortSignal,
): Promise<string | null> {
  return await new Promise((resolve) => {
    const child = spawn(executable, args, {
      env: { LANG: "C", LC_ALL: "C", PATH: "" },
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let overflow = false;
    let forcedStop = false;
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolve(value);
    };
    const collect = (chunk: Buffer): void => {
      if (overflow) return;
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > MAX_VERSION_BYTES) {
        overflow = true;
        forcedStop = true;
        killProbeTree(child);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const abort = (): void => {
      forcedStop = true;
      killProbeTree(child);
    };
    const timeout = setTimeout(() => {
      forcedStop = true;
      killProbeTree(child);
    }, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.once("error", () => finish(null));
    child.once("close", (code) => {
      finish(code === 0 && !overflow && !forcedStop ? output : null);
    });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw Object.assign(new Error("Toolchain detection cancelled"), {
    name: "AbortError",
  });
}

async function probeToolchains(ctx: ToolchainContext): Promise<ToolchainReport> {
  validateContext(ctx);
  const found: ToolchainReport["found"] = [];
  const missing: ToolchainReport["missing"] = [];
  for (const probe of ctx.probes) {
    throwIfAborted(ctx.signal);
    const executable = await resolveExecutable(probe.binary, ctx.path);
    throwIfAborted(ctx.signal);
    if (executable === null) {
      missing.push({ id: probe.id, unlocks: probe.unlocks });
      continue;
    }
    const output = await captureVersion(
      executable,
      probe.versionArgs,
      ctx.probeTimeoutMs,
      ctx.signal,
    );
    throwIfAborted(ctx.signal);
    const version = output === null ? null : probe.parse(output);
    if (version === null) {
      missing.push({ id: probe.id, unlocks: probe.unlocks });
      continue;
    }
    found.push({ id: probe.id, version, path: executable });
  }
  const configured = CAPABILITIES.some(
    (capability) =>
      ctx.probes.some((probe) => probe.unlocks === capability) &&
      !missing.some((probe) => probe.unlocks === capability),
  );
  return {
    found,
    missing,
    configured,
  };
}

function cacheIdentity(ctx: ToolchainContext): string {
  return JSON.stringify({
    path: ctx.path,
    probeTimeoutMs: ctx.probeTimeoutMs,
    probes: ctx.probes.map((probe) => ({
      id: probe.id,
      binary: probe.binary,
      versionArgs: probe.versionArgs,
      unlocks: probe.unlocks,
    })),
  });
}

export function detectToolchains(ctx: ToolchainContext): Promise<ToolchainReport> {
  const identity = cacheIdentity(ctx);
  let entries = cache.get(ctx.cacheKey);
  const existing = entries?.get(identity);
  if (existing) return existing;
  if (!entries) {
    entries = new Map();
    cache.set(ctx.cacheKey, entries);
  }
  const pending = probeToolchains(ctx).catch((error: unknown) => {
    entries.delete(identity);
    if (entries.size === 0) cache.delete(ctx.cacheKey);
    throw error;
  });
  entries.set(identity, pending);
  return pending;
}

export function redetectToolchains(ctx: ToolchainContext): Promise<ToolchainReport> {
  const entries = cache.get(ctx.cacheKey);
  entries?.delete(cacheIdentity(ctx));
  if (entries?.size === 0) cache.delete(ctx.cacheKey);
  return detectToolchains(ctx);
}
