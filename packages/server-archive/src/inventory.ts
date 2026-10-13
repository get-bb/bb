import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { lstatOrNull } from "./fs-utils.js";
import { isSafeRelativePath, resolveRelativePath } from "./relative-path.js";
import {
  findServerOwnedRoot,
  isServerOwnedPluginDirectoryName,
  isServerSqliteDatabasePath,
  PLUGINS_DIR_NAME,
  SERVER_OWNED_TOP_LEVEL_DIRECTORIES,
  SERVER_OWNED_TOP_LEVEL_FILES,
  type ServerOwnedRoot,
} from "./server-owned-paths.js";

export type ServerOwnedEntryKind = "file" | "directory";

export interface ServerOwnedFile {
  path: string;
  absolutePath: string;
  sizeBytes: number;
  sqliteDatabase: boolean;
}

export interface ServerOwnedEntry {
  path: string;
  kind: ServerOwnedEntryKind;
  files: ServerOwnedFile[];
}

export interface ServerOwnedInventory {
  entries: ServerOwnedEntry[];
  skippedPaths: string[];
}

function compareNames(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

async function readSortedDirectory(path: string): Promise<Dirent[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.sort((left, right) => compareNames(left.name, right.name));
}

async function collectDirectoryFiles(
  absolutePath: string,
  relativePath: string,
  files: ServerOwnedFile[],
  inventory: ServerOwnedInventory,
): Promise<void> {
  for (const child of await readSortedDirectory(absolutePath)) {
    const childRelativePath = `${relativePath}/${child.name}`;
    const childAbsolutePath = join(absolutePath, child.name);
    if (!isSafeRelativePath(childRelativePath)) {
      inventory.skippedPaths.push(childRelativePath);
      continue;
    }
    if (child.isDirectory()) {
      await collectDirectoryFiles(
        childAbsolutePath,
        childRelativePath,
        files,
        inventory,
      );
      continue;
    }
    if (!child.isFile()) {
      inventory.skippedPaths.push(childRelativePath);
      continue;
    }
    const stats = await lstatOrNull(childAbsolutePath);
    if (stats?.isFile() === true) {
      files.push({
        path: childRelativePath,
        absolutePath: childAbsolutePath,
        sizeBytes: stats.size,
        sqliteDatabase: false,
      });
    }
  }
}

async function collectRoot(
  dataDir: string,
  root: ServerOwnedRoot,
  inventory: ServerOwnedInventory,
): Promise<void> {
  const absolutePath = resolveRelativePath(dataDir, root.path);
  const stats = await lstatOrNull(absolutePath);
  if (stats === null) {
    return;
  }
  if (stats.isFile()) {
    inventory.entries.push({
      path: root.path,
      kind: "file",
      files: [
        {
          path: root.path,
          absolutePath,
          sizeBytes: stats.size,
          sqliteDatabase: isServerSqliteDatabasePath(root.path),
        },
      ],
    });
    return;
  }
  if (stats.isDirectory() && root.kind === "tree") {
    const files: ServerOwnedFile[] = [];
    await collectDirectoryFiles(absolutePath, root.path, files, inventory);
    inventory.entries.push({ path: root.path, kind: "directory", files });
    return;
  }
  inventory.skippedPaths.push(root.path);
}

async function collectCandidateRoot(
  dataDir: string,
  relativePath: string,
  inventory: ServerOwnedInventory,
): Promise<void> {
  if (!isSafeRelativePath(relativePath)) {
    inventory.skippedPaths.push(relativePath);
    return;
  }
  const root = findServerOwnedRoot(relativePath);
  if (root?.path === relativePath) {
    await collectRoot(dataDir, root, inventory);
  }
}

async function collectPluginRoots(
  dataDir: string,
  inventory: ServerOwnedInventory,
): Promise<void> {
  const pluginsDir = join(dataDir, PLUGINS_DIR_NAME);
  const stats = await lstatOrNull(pluginsDir);
  if (stats === null) {
    return;
  }
  if (!stats.isDirectory()) {
    inventory.skippedPaths.push(PLUGINS_DIR_NAME);
    return;
  }
  for (const plugin of await readSortedDirectory(pluginsDir)) {
    const pluginPath = `${PLUGINS_DIR_NAME}/${plugin.name}`;
    if (!isServerOwnedPluginDirectoryName(plugin.name)) {
      await collectCandidateRoot(dataDir, pluginPath, inventory);
      continue;
    }
    if (plugin.isSymbolicLink()) {
      inventory.skippedPaths.push(pluginPath);
      continue;
    }
    if (!plugin.isDirectory()) {
      continue;
    }
    for (const child of await readSortedDirectory(
      join(pluginsDir, plugin.name),
    )) {
      await collectCandidateRoot(
        dataDir,
        `${pluginPath}/${child.name}`,
        inventory,
      );
    }
  }
}

export async function listServerOwnedEntries(
  dataDir: string,
): Promise<ServerOwnedInventory> {
  const inventory: ServerOwnedInventory = { entries: [], skippedPaths: [] };
  for (const relativePath of [
    ...SERVER_OWNED_TOP_LEVEL_FILES,
    ...SERVER_OWNED_TOP_LEVEL_DIRECTORIES,
  ]) {
    await collectCandidateRoot(dataDir, relativePath, inventory);
  }
  await collectPluginRoots(dataDir, inventory);
  inventory.entries.sort((left, right) => compareNames(left.path, right.path));
  inventory.skippedPaths.sort(compareNames);
  return inventory;
}
