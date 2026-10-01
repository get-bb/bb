import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { lowerPriority } from "./disk-usage.js";
import { isFsErrorWithCode } from "./fs-errors.js";

const SKIPPABLE = ["ENOENT", "ENOTDIR", "EACCES", "EPERM"];

function findWithCommand(
  root: string,
  minBytes: number,
  signal: AbortSignal,
): Promise<string[] | null> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(
      "find",
      [root, "-type", "f", "-size", `+${minBytes - 1}c`, "-print0"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const stdout: Buffer[] = [];
    const kill = () => child.kill("SIGKILL");
    signal.addEventListener("abort", kill, { once: true });
    if (child.pid !== undefined) lowerPriority(child.pid);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.once("error", (error) => {
      signal.removeEventListener("abort", kill);
      if (isFsErrorWithCode(error, "ENOENT")) resolve(null);
      else reject(error);
    });
    child.once("close", () => {
      signal.removeEventListener("abort", kill);
      if (signal.aborted) return reject(signal.reason);
      resolve(
        Buffer.concat(stdout).toString("utf8").split("\0").filter(Boolean),
      );
    });
  });
}

async function findWithWalker(
  root: string,
  minBytes: number,
  signal: AbortSignal,
): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  for (let directory = pending.pop(); directory; directory = pending.pop()) {
    signal.throwIfAborted();
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (SKIPPABLE.some((code) => isFsErrorWithCode(error, code))) continue;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) {
        const stats = await fs.lstat(entryPath).catch(() => null);
        if (stats !== null && stats.size >= minBytes) found.push(entryPath);
      }
    }
  }
  return found;
}

export async function findLargeFiles(
  root: string,
  minBytes: number,
  signal: AbortSignal,
): Promise<{ path: string; sizeBytes: number }[]> {
  const paths =
    (process.platform === "win32"
      ? null
      : await findWithCommand(root, minBytes, signal)) ??
    (await findWithWalker(root, minBytes, signal));
  const files: { path: string; sizeBytes: number }[] = [];
  for (const filePath of paths) {
    signal.throwIfAborted();
    try {
      const stats = await fs.lstat(filePath);
      if (stats.isFile()) files.push({ path: filePath, sizeBytes: stats.size });
    } catch (error) {
      if (!SKIPPABLE.some((code) => isFsErrorWithCode(error, code)))
        throw error;
    }
  }
  return files;
}
