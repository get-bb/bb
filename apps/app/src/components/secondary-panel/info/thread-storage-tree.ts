import type { WorkspaceFile } from "@bb/server-contract";

export interface ThreadStorageFolderNode {
  kind: "folder";
  path: string;
  name: string;
  children: readonly ThreadStorageTreeNode[];
}

export interface ThreadStorageFileNode {
  kind: "file";
  path: string;
  name: string;
}

export type ThreadStorageTreeNode =
  | ThreadStorageFolderNode
  | ThreadStorageFileNode;

export interface ThreadStorageTreeRow {
  node: ThreadStorageTreeNode;
  depth: number;
}

interface MutableFolder {
  path: string;
  name: string;
  folders: Map<string, MutableFolder>;
  files: ThreadStorageFileNode[];
}

const compareNames = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });

function finalizeChildren(folder: MutableFolder): ThreadStorageTreeNode[] {
  const folders = [...folder.folders.values()]
    .map(finalizeFolder)
    .sort(compareNames);
  const files = [...folder.files].sort(compareNames);
  return [...folders, ...files];
}

function finalizeFolder(folder: MutableFolder): ThreadStorageFolderNode {
  let current = folder;
  let name = folder.name;
  while (current.files.length === 0 && current.folders.size === 1) {
    const [onlyChild] = current.folders.values();
    if (!onlyChild) break;
    current = onlyChild;
    name = `${name}/${onlyChild.name}`;
  }
  return {
    kind: "folder",
    path: current.path,
    name,
    children: finalizeChildren(current),
  };
}

export function buildThreadStorageTree(
  files: readonly WorkspaceFile[],
): ThreadStorageTreeNode[] {
  const root: MutableFolder = {
    path: "",
    name: "",
    folders: new Map(),
    files: [],
  };
  for (const file of files) {
    const segments = file.path.split("/").filter((segment) => segment !== "");
    const fileName = segments.pop();
    if (fileName === undefined) continue;
    let folder = root;
    for (const segment of segments) {
      let child = folder.folders.get(segment);
      if (!child) {
        child = {
          path: folder.path === "" ? segment : `${folder.path}/${segment}`,
          name: segment,
          folders: new Map(),
          files: [],
        };
        folder.folders.set(segment, child);
      }
      folder = child;
    }
    folder.files.push({ kind: "file", path: file.path, name: fileName });
  }
  return finalizeChildren(root);
}

export function threadStorageAncestorPaths(path: string): string[] {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function flattenThreadStorageNode(
  node: ThreadStorageTreeNode,
  isExpanded: (folderPath: string) => boolean,
  depth = 0,
): ThreadStorageTreeRow[] {
  const rows: ThreadStorageTreeRow[] = [{ node, depth }];
  if (node.kind === "folder" && isExpanded(node.path)) {
    for (const child of node.children) {
      rows.push(...flattenThreadStorageNode(child, isExpanded, depth + 1));
    }
  }
  return rows;
}
