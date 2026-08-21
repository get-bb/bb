import {
  createFilePreviewLineRange,
  type EnvironmentFilePreviewSource,
  type FilePreviewLineRange,
  type WorkspaceFilePreviewStatusLabel,
} from "@bb/client-core";
import { formatLineRange } from "@/data/files/file-preview-model";

/**
 * What the file preview shows: which source the bytes come from and the path
 * inside it. Mirrors the web's workspace / host / thread-storage / project
 * file tab states (`@bb/client-core` file-preview.ts) and round-trips through
 * the `/threads/[id]/files?kind=&path=&line=` route params so a preview can
 * be deep-linked, pushed from markdown, or opened as a panel tab.
 */
export type FilePreviewTarget =
  | {
      kind: "workspace-file";
      /** Workspace-relative path. */
      path: string;
      source: EnvironmentFilePreviewSource;
      statusLabel: WorkspaceFilePreviewStatusLabel | null;
    }
  | {
      kind: "host-file";
      /** Absolute path on the thread's host. */
      path: string;
    }
  | {
      kind: "storage-file";
      /** Path relative to the thread storage root. */
      path: string;
    }
  | {
      kind: "project-file";
      /** Project-relative path (threads without an environment yet). */
      path: string;
    };

type FilePreviewTargetKind = FilePreviewTarget["kind"];

/** `kind` route param values. */
const FILE_PREVIEW_ROUTE_KINDS = {
  "workspace-file": "workspace",
  "host-file": "host",
  "storage-file": "storage",
  "project-file": "project",
} as const satisfies Record<FilePreviewTargetKind, string>;

type FilePreviewRouteKind =
  (typeof FILE_PREVIEW_ROUTE_KINDS)[FilePreviewTargetKind];

const ROUTE_KIND_TO_TARGET_KIND: Record<
  FilePreviewRouteKind,
  FilePreviewTargetKind
> = {
  workspace: "workspace-file",
  host: "host-file",
  storage: "storage-file",
  project: "project-file",
};

export interface FilePreviewRouteParams {
  kind?: string;
  path?: string;
  /** `12` or `12-20`. */
  line?: string;
  /** `working-tree` | `head` | `merge-base:<ref>` (workspace files). */
  source?: string;
  /** `deleted` (workspace files). */
  status?: string;
}

function serializeSource(source: EnvironmentFilePreviewSource): string {
  return source.kind === "merge-base"
    ? `merge-base:${source.ref}`
    : source.kind;
}

function parseSource(value: string | undefined): EnvironmentFilePreviewSource {
  if (value === undefined || value === "working-tree") {
    return { kind: "working-tree" };
  }
  if (value === "head") return { kind: "head" };
  if (value.startsWith("merge-base:") && value.length > "merge-base:".length) {
    return { kind: "merge-base", ref: value.slice("merge-base:".length) };
  }
  return { kind: "working-tree" };
}

/** `12` / `12-20` → line range; anything else → null. */
export function parseLineParam(
  value: string | undefined,
): FilePreviewLineRange | null {
  if (value === undefined) return null;
  const match = /^([0-9]+)(?:-([0-9]+))?$/u.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  return createFilePreviewLineRange({
    startLineNumber: start,
    endLineNumber: end,
  });
}

function serializeLineParam(
  lineRange: FilePreviewLineRange | null,
): string | undefined {
  return lineRange === null
    ? undefined
    : formatLineRange(lineRange.startLineNumber, lineRange.endLineNumber);
}

/** Route params for `target` (+ line), all values strings. */
export function buildFilePreviewRouteParams(
  target: FilePreviewTarget,
  lineRange: FilePreviewLineRange | null,
): Record<string, string | undefined> {
  const base: Record<string, string | undefined> = {
    kind: FILE_PREVIEW_ROUTE_KINDS[target.kind],
    path: target.path,
    line: serializeLineParam(lineRange),
  };
  if (target.kind === "workspace-file") {
    base.source = serializeSource(target.source);
    base.status = target.statusLabel ?? undefined;
  }
  return base;
}

interface ParsedFilePreviewRoute {
  target: FilePreviewTarget;
  lineRange: FilePreviewLineRange | null;
}

/** Null when the params do not describe a file (the route shows the browser). */
export function parseFilePreviewRouteParams(
  params: FilePreviewRouteParams,
): ParsedFilePreviewRoute | null {
  const path = params.path?.trim() ?? "";
  const kind = params.kind?.trim() ?? "";
  if (path.length === 0 || !(kind in ROUTE_KIND_TO_TARGET_KIND)) return null;
  const targetKind = ROUTE_KIND_TO_TARGET_KIND[kind as FilePreviewRouteKind];
  const lineRange = parseLineParam(params.line);
  switch (targetKind) {
    case "workspace-file":
      return {
        target: {
          kind: "workspace-file",
          path,
          source: parseSource(params.source),
          statusLabel: params.status === "deleted" ? "deleted" : null,
        },
        lineRange,
      };
    case "host-file":
    case "storage-file":
    case "project-file":
      return { target: { kind: targetKind, path }, lineRange };
  }
}

/** Source label for the header pill. */
export function describeFilePreviewTargetSource(
  target: FilePreviewTarget,
): string {
  switch (target.kind) {
    case "workspace-file":
      if (target.statusLabel === "deleted") return "Deleted";
      return target.source.kind === "working-tree"
        ? "Workspace"
        : target.source.kind === "head"
          ? "HEAD"
          : `Merge base ${target.source.ref.slice(0, 7)}`;
    case "host-file":
      return "Host";
    case "storage-file":
      return "Thread storage";
    case "project-file":
      return "Project";
  }
}
