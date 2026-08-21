import { compareCodepoint } from "@bb/client-core";
import type { WorkspaceFile } from "@bb/server-contract";

/**
 * Thread storage arrives as a flat `WorkspaceFile[]` (`path` relative to the
 * storage root, `name`). The browser derives directories client-side (web
 * `useThreadStorageBrowser.ts` `buildDirectoryPaths`) and lists one directory
 * at a time with breadcrumbs. Pure and vitest-tested.
 */

export interface StorageDirectoryEntry {
  kind: "directory";
  /** Directory path relative to the root, no trailing slash. */
  path: string;
  name: string;
  /** Files anywhere beneath this directory. */
  fileCount: number;
}

export interface StorageFileEntry {
  kind: "file";
  path: string;
  name: string;
}

export type StorageEntry = StorageDirectoryEntry | StorageFileEntry;

export interface StorageBreadcrumb {
  /** "" for the root. */
  path: string;
  label: string;
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/** Every directory path (no trailing slash) implied by the file paths. */
export function buildStorageDirectoryPaths(
  files: readonly Pick<WorkspaceFile, "path">[],
): string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = splitPath(file.path);
    let current = "";
    for (const segment of segments.slice(0, -1)) {
      current = current.length === 0 ? segment : `${current}/${segment}`;
      directories.add(current);
    }
  }
  return Array.from(directories);
}

function compareEntries(a: StorageEntry, b: StorageEntry): number {
  if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
  return (
    compareCodepoint(a.name.toLowerCase(), b.name.toLowerCase()) ||
    compareCodepoint(a.name, b.name)
  );
}

/**
 * Immediate children of `directoryPath` ("" = root): subdirectories first
 * (with a recursive file count), then files, each group sorted by name.
 */
export function listStorageDirectory(
  files: readonly WorkspaceFile[],
  directoryPath: string,
): StorageEntry[] {
  const prefix = directoryPath.length === 0 ? "" : `${directoryPath}/`;
  const directories = new Map<string, number>();
  const entries: StorageEntry[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      entries.push({
        kind: "file",
        path: file.path,
        name: file.name.length > 0 ? file.name : rest,
      });
      continue;
    }
    const childName = rest.slice(0, slash);
    if (childName.length === 0) continue;
    directories.set(childName, (directories.get(childName) ?? 0) + 1);
  }
  for (const [name, fileCount] of directories) {
    entries.push({
      kind: "directory",
      path: `${prefix}${name}`,
      name,
      fileCount,
    });
  }
  return entries.sort(compareEntries);
}

/** Root crumb plus one per segment of `directoryPath`. */
export function buildStorageBreadcrumbs(
  directoryPath: string,
  rootLabel = "Storage",
): StorageBreadcrumb[] {
  const crumbs: StorageBreadcrumb[] = [{ path: "", label: rootLabel }];
  let current = "";
  for (const segment of splitPath(directoryPath)) {
    current = current.length === 0 ? segment : `${current}/${segment}`;
    crumbs.push({ path: current, label: segment });
  }
  return crumbs;
}

export function parentStorageDirectory(directoryPath: string): string {
  const segments = splitPath(directoryPath);
  return segments.slice(0, -1).join("/");
}

export interface StorageFileMatch {
  file: WorkspaceFile;
  /** Character offsets in `file.path` that matched (for highlighting). */
  positions: number[];
}

/**
 * Case-insensitive substring filter over the flat list (web
 * `useThreadStorageBrowser` `filteredFiles`), with the match offsets so the
 * row can highlight them. An empty query matches everything (no positions).
 */
export function filterStorageFiles(
  files: readonly WorkspaceFile[],
  query: string,
): StorageFileMatch[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return files.map((file) => ({ file, positions: [] }));
  }
  const matches: StorageFileMatch[] = [];
  for (const file of files) {
    const index = file.path.toLowerCase().indexOf(normalized);
    if (index === -1) continue;
    const positions: number[] = [];
    for (let offset = 0; offset < normalized.length; offset += 1) {
      positions.push(index + offset);
    }
    matches.push({ file, positions });
  }
  return matches;
}
