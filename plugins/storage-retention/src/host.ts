import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hostStorageContract } from "./host-contract.js";
import { measureDiskUsage } from "./disk-usage.js";
import { isFsErrorWithCode } from "./fs-errors.js";

const STORAGE_ENTRY = /^(thr_[a-zA-Z0-9]+|\.bb-trash-[a-zA-Z0-9_-]+)$/;

function assertStorageEntry(rootPath: string, name: string) {
  if (
    !path.isAbsolute(rootPath) ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    !STORAGE_ENTRY.test(name)
  )
    throw new Error("Invalid storage entry");
}

export default experimental_defineHostEntry({
  contract: hostStorageContract,
  handlers: {
    measure: (input, context) =>
      measureDiskUsage(input, undefined, context.signal),
    async discardLargeFiles({ rootPath, names, minBytes }, context) {
      for (const name of names) assertStorageEntry(rootPath, name);
      let root: string;
      try {
        root = await fs.realpath(rootPath);
      } catch (error) {
        if (isFsErrorWithCode(error, "ENOENT")) return { removed: [] };
        throw error;
      }
      const removed = [];
      for (const name of names) {
        const directory = path.join(root, name);
        const stats = await fs.lstat(directory).catch((error: unknown) => {
          if (isFsErrorWithCode(error, "ENOENT")) return null;
          throw error;
        });
        if (stats === null) continue;
        if (stats.isSymbolicLink() || !stats.isDirectory())
          throw new Error(
            "Storage entry must be a directory, not a symbolic link",
          );
        let sizeBytes = 0;
        let count = 0;
        const { largeFiles } = await measureDiskUsage(
          {
            targets: [{ path: directory, perChild: false }],
            timeoutMs: 29 * 60_000,
            largeFileMinBytes: minBytes,
          },
          { duCommand: null },
          context.signal,
        );
        for (const file of largeFiles) {
          context.signal.throwIfAborted();
          const relative = path.relative(directory, file.path);
          if (
            !path.isAbsolute(file.path) ||
            relative === "" ||
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
          )
            throw new Error("Large file must be inside its storage directory");
          try {
            const current = await fs.lstat(file.path);
            if (!current.isFile()) continue;
            const currentBytes =
              process.platform === "win32"
                ? current.size
                : current.blocks * 512;
            if (currentBytes < minBytes) continue;
            if ((await fs.realpath(file.path)) !== file.path) continue;
            context.signal.throwIfAborted();
            await fs.unlink(file.path);
            sizeBytes += currentBytes;
            count++;
          } catch (error) {
            if (
              !isFsErrorWithCode(error, "ENOENT") &&
              !isFsErrorWithCode(error, "ENOTDIR")
            )
              throw error;
          }
        }
        removed.push({ name, sizeBytes, count });
      }
      return { removed };
    },
    async capacity({ path: target }) {
      if (!path.isAbsolute(target)) throw new Error("Invalid storage path");
      for (let current = target; ; current = path.dirname(current)) {
        try {
          const stats = await fs.statfs(current);
          return {
            totalBytes: stats.blocks * stats.bsize,
            freeBytes: stats.bavail * stats.bsize,
          };
        } catch (error) {
          if (
            !isFsErrorWithCode(error, "ENOENT") ||
            current === path.dirname(current)
          )
            throw error;
        }
      }
    },
    async discard({ rootPath, names, recreate }, context) {
      for (const name of names) {
        assertStorageEntry(rootPath, name);
        if (recreate && name.startsWith(".bb-trash-"))
          throw new Error("Cannot recreate a trash directory");
      }
      context.signal.throwIfAborted();
      if (recreate) await fs.mkdir(rootPath, { recursive: true });
      let root: string;
      try {
        root = await fs.realpath(rootPath);
      } catch (error) {
        if (isFsErrorWithCode(error, "ENOENT")) return { removed: [] };
        throw error;
      }
      const removed: string[] = [];
      const trashes: string[] = [];
      try {
        for (const name of names) {
          context.signal.throwIfAborted();
          const source = path.join(root, name);
          try {
            const stat = await fs.lstat(source);
            if (stat.isSymbolicLink() || !stat.isDirectory())
              throw new Error(
                "Storage entry must be a directory, not a symbolic link",
              );
            const trash = name.startsWith(".bb-trash-")
              ? source
              : path.join(root, `.bb-trash-${name}-${randomUUID()}`);
            if (source !== trash) await fs.rename(source, trash);
            trashes.push(trash);
            removed.push(name);
          } catch (error) {
            if (!isFsErrorWithCode(error, "ENOENT")) throw error;
          }
          if (recreate) await fs.mkdir(source, { recursive: true });
        }
      } finally {
        if (trashes.length > 0) {
          const lease = context.experimental_retainWorker();
          void (async () => {
            for (const trash of trashes)
              await fs
                .rm(trash, { recursive: true, force: true })
                .catch((error) => {
                  console.error("Storage trash cleanup failed", error);
                });
          })().finally(() => lease.dispose());
        }
      }
      return { removed };
    },
  },
});
