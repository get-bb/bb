import { readdir, stat, open } from "node:fs/promises";
import type { FsDirEntry, FsReader, FsStat } from "./discovery.js";

export const nodeFsReader: FsReader = {
  async readDir(dirPath) {
    const raw = await readdir(dirPath, { withFileTypes: true });
    return raw.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  },
  async stat(targetPath): Promise<FsStat | null> {
    try {
      const info = await stat(targetPath);
      return { isDirectory: info.isDirectory(), isFile: info.isFile() };
    } catch {
      return null;
    }
  },
  async readFileUtf8(targetPath, maxBytes) {
    try {
      const handle = await open(targetPath, "r");
      try {
        const info = await handle.stat();
        const length = Math.min(info.size, maxBytes);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  },
};

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
