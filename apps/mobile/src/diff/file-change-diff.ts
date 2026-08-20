/**
 * Turns a timeline `file-change` row's `change` into something the diff
 * components can render, mirroring the web's `TimelineFileDiffBlock`:
 * client-core synthesizes a renderable patch (created/deleted files, bare
 * hunks, metadata stripping), we parse it, and when that yields anything but
 * exactly one file we fall back to the raw text (`getPlainDiffFallback`).
 * Results are cached per `change` object, as on the web.
 */
import { getPlainDiffFallback, getRenderablePatchText } from "@bb/client-core";
import type { TimelineFileChange } from "@bb/server-contract";
import { parseUnifiedDiff, type DiffFile } from "./parse-unified-diff";

export type FileChangeDiffView =
  | {
      kind: "diff";
      file: DiffFile;
      /** False for synthesized patches whose hunk headers are invented. */
      showLineNumbers: boolean;
    }
  | { kind: "plain"; text: string }
  | { kind: "none" };

const cache = new WeakMap<TimelineFileChange, FileChangeDiffView>();

function build(change: TimelineFileChange): FileChangeDiffView {
  const renderable = getRenderablePatchText(change);
  let file: DiffFile | null = null;
  if (renderable !== null) {
    const parsed = parseUnifiedDiff(renderable.patch);
    file = parsed.files.length === 1 ? parsed.files[0]! : null;
  }
  if (file !== null && renderable !== null) {
    return {
      kind: "diff",
      file,
      showLineNumbers: !renderable.disableLineNumbers,
    };
  }
  const plain = getPlainDiffFallback(change, false);
  return plain === null ? { kind: "none" } : { kind: "plain", text: plain };
}

export function buildFileChangeDiffView(
  change: TimelineFileChange,
): FileChangeDiffView {
  const cached = cache.get(change);
  if (cached) return cached;
  const view = build(change);
  cache.set(change, view);
  return view;
}

/**
 * Strips the workspace root from a diff path for display so timeline diffs
 * show repo-relative paths. Timeline changes carry absolute paths, and
 * client-core's synthetic patches drop the leading slash
 * (`Users/dev/repo/a.ts`), so both sides are compared without leading or
 * trailing slashes.
 */
export function displayDiffPath(
  path: string,
  workspaceRootPath: string | null | undefined,
): string {
  if (!workspaceRootPath) return path;
  const root = workspaceRootPath.replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (root.length === 0) return path;
  const bare = path.replace(/^\/+/u, "");
  return bare.startsWith(`${root}/`) ? bare.slice(root.length + 1) : path;
}
