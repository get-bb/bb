export type EntryKind = "file" | "directory";

export interface FlatEntry {
  path: string;
  kind: EntryKind;
}

export interface TreeNode {
  /** Path relative to the notes root, `/`-separated. */
  path: string;
  name: string;
  kind: EntryKind;
  children: TreeNode[];
}

/** Extensions the panel will open. Everything else stays out of the tree. */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdx", "mdown", "mkd"];

export function isMarkdownPath(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return MARKDOWN_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
}

/**
 * Builds the nested tree the sidebar renders.
 *
 * Directories are kept even when empty: a folder the user just created, or
 * one holding only non-Markdown attachments, still needs somewhere to appear
 * or it looks as though the creation failed.
 */
export function buildTree(entries: readonly FlatEntry[]): TreeNode[] {
  const root: TreeNode = { path: "", name: "", kind: "directory", children: [] };
  const byPath = new Map<string, TreeNode>([["", root]]);

  const directoryAt = (path: string): TreeNode => {
    const existing = byPath.get(path);
    if (existing !== undefined) return existing;
    const separator = path.lastIndexOf("/");
    const parent = directoryAt(separator === -1 ? "" : path.slice(0, separator));
    const node: TreeNode = {
      path,
      name: path.slice(separator + 1),
      kind: "directory",
      children: [],
    };
    byPath.set(path, node);
    parent.children.push(node);
    return node;
  };

  for (const entry of entries) {
    const path = normalizePath(entry.path);
    if (path === "") continue;
    if (path.split("/").some((segment) => segment.startsWith("."))) continue;

    if (entry.kind === "directory") {
      directoryAt(path);
      continue;
    }
    if (!isMarkdownPath(path)) continue;
    if (byPath.has(path)) continue;

    const separator = path.lastIndexOf("/");
    const parent = directoryAt(separator === -1 ? "" : path.slice(0, separator));
    const node: TreeNode = {
      path,
      name: path.slice(separator + 1),
      kind: "file",
      children: [],
    };
    byPath.set(path, node);
    parent.children.push(node);
  }

  sortRecursively(root);
  return root.children;
}

function sortRecursively(node: TreeNode): void {
  node.children.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
  });
  for (const child of node.children) sortRecursively(child);
}

export function ancestorsOf(path: string): string[] {
  const segments = normalizePath(path).split("/");
  segments.pop();
  const ancestors: string[] = [];
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}/${segment}`;
    ancestors.push(current);
  }
  return ancestors;
}

export interface FilteredTree {
  nodes: TreeNode[];
  /** Directories to force open so the surviving matches are visible. */
  expand: Set<string>;
}

export function filterTree(
  nodes: readonly TreeNode[],
  query: string,
): FilteredTree {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { nodes: [...nodes], expand: new Set() };

  const expand = new Set<string>();
  const visit = (node: TreeNode): TreeNode | null => {
    if (node.kind === "file") {
      return node.path.toLowerCase().includes(needle) ? node : null;
    }
    const children = node.children
      .map(visit)
      .filter((child): child is TreeNode => child !== null);
    // A folder whose own name matches is worth showing even if nothing
    // inside it does, so the user can open or add to it.
    if (children.length === 0) {
      return node.name.toLowerCase().includes(needle)
        ? { ...node, children: [] }
        : null;
    }
    expand.add(node.path);
    return { ...node, children };
  };

  return {
    nodes: nodes.map(visit).filter((node): node is TreeNode => node !== null),
    expand,
  };
}

/**
 * Validates a name typed into the sidebar before it becomes a path.
 *
 * The server re-checks containment, but refusing separators and `..` here
 * turns a traversal attempt into an inline message instead of a failed RPC.
 */
export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a name";
  if (trimmed === "." || trimmed === "..") return "That name is reserved";
  if (/[/\\]/.test(trimmed)) return "Names cannot contain slashes";
  if (trimmed.startsWith(".")) return "Names cannot start with a dot";
  if (/[\u0000-\u001f]/.test(trimmed)) return "Names cannot contain control characters";
  if (trimmed.length > 255) return "That name is too long";
  return null;
}

/** Appends `.md` unless the name already carries a Markdown extension. */
export function withMarkdownExtension(name: string): string {
  const trimmed = name.trim();
  return isMarkdownPath(trimmed) ? trimmed : `${trimmed}.md`;
}

export function joinPath(directory: string, name: string): string {
  const base = normalizePath(directory);
  return base === "" ? name : `${base}/${name}`;
}

/**
 * Decodes the panel's route remainder back into a filesystem path.
 *
 * `toPluginPanel` percent-encodes each segment, so a note called
 * `meeting notes.md` comes back as `meeting%20notes.md` and would be looked
 * up under that literal name. Decoding is per segment, and a malformed
 * escape falls back to the raw text rather than throwing, so one odd
 * filename cannot blank the panel.
 */
export function decodeSubPath(subPath: string): string {
  return subPath
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

export function parentOf(path: string): string {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? "" : normalized.slice(0, separator);
}
