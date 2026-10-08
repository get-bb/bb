import type { WorkspaceFile } from "@bb/server-contract";

export interface ThreadStorageFolderNode {
  kind: "folder";
  path: string;
  chainPaths: readonly string[];
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

export type ThreadStorageTreeRow =
  | { kind: "node"; node: ThreadStorageTreeNode; depth: number }
  | {
      kind: "more";
      folderPath: string;
      hiddenCount: number;
      depth: number;
    };

export interface ThreadStorageFlattenOptions {
  isExpanded: (folderPath: string) => boolean;
  showsAllChildren: (folderPath: string) => boolean;
  childLimit: number;
}

interface MutableFolder {
  path: string;
  name: string;
  folders: Map<string, MutableFolder>;
  files: ThreadStorageFileNode[];
}

const NAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const compareNames = (left: { name: string }, right: { name: string }) =>
  NAME_COLLATOR.compare(left.name, right.name);

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
  const chainPaths = [folder.path];
  while (current.files.length === 0 && current.folders.size === 1) {
    const [onlyChild] = current.folders.values();
    if (!onlyChild) break;
    current = onlyChild;
    name = `${name}/${onlyChild.name}`;
    chainPaths.push(current.path);
  }
  return {
    kind: "folder",
    path: current.path,
    chainPaths,
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
  options: ThreadStorageFlattenOptions,
  depth = 0,
): ThreadStorageTreeRow[] {
  const rows: ThreadStorageTreeRow[] = [{ kind: "node", node, depth }];
  if (node.kind !== "folder" || !options.isExpanded(node.path)) return rows;
  const { children } = node;
  const capped =
    children.length > options.childLimit + 1 &&
    !options.showsAllChildren(node.path);
  const visibleChildren = capped
    ? children.slice(0, options.childLimit)
    : children;
  for (const child of visibleChildren) {
    rows.push(...flattenThreadStorageNode(child, options, depth + 1));
  }
  if (capped) {
    rows.push({
      kind: "more",
      folderPath: node.path,
      hiddenCount: children.length - options.childLimit,
      depth: depth + 1,
    });
  }
  return rows;
}
