import {
  experimental_InfoList as InfoList,
  experimental_useAppPanel as useAppPanel,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { DiffSizeBar, DiffStatsTally } from "@bb/shared-ui/diff-stats-tally";
import { InfoListRow } from "@bb/shared-ui/info-list-row";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  formatOmittedChangedFilesLabel,
  selectWorkspaceChangedFilesSections,
  toChangeTally,
  type WorkspaceChangedFileSelection,
  type WorkspaceChangedFilesSection,
} from "@bb/shared-ui/workspace-change-summary";
import { useCallback } from "react";
import {
  GIT_DIFF_TAB_ID,
  type WorkspaceFileStatus,
  type WorkspaceFileStatusKind,
  type WorkspaceStatus,
} from "../contract.js";

interface FileStatusGlyph {
  icon: IconName;
  label: string;
  className: string;
}

export const FILE_STATUS_GLYPHS: Record<
  WorkspaceFileStatusKind,
  FileStatusGlyph
> = {
  M: { icon: "DiffModified", label: "Modified", className: "text-subtle-foreground" },
  A: { icon: "DiffAdded", label: "Added", className: "text-diff-added" },
  "??": { icon: "DiffAdded", label: "Added", className: "text-diff-added" },
  D: { icon: "DiffRemoved", label: "Deleted", className: "text-diff-removed" },
  R: { icon: "DiffRenamed", label: "Renamed", className: "text-subtle-foreground" },
  C: { icon: "Copy", label: "Copied", className: "text-subtle-foreground" },
  U: { icon: "DiffConflict", label: "Conflict", className: "text-destructive" },
  "?": { icon: "CircleQuestion", label: "Unknown", className: "text-subtle-foreground" },
};

function fileName(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, "");
  return normalized.split(/[\\/]/u).at(-1) ?? path;
}

function folderHint(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  return index <= 0 ? undefined : `${path.slice(0, index)}/`;
}

export function selectChangedFilesSection(
  workspaceStatus: WorkspaceStatus | undefined,
  kind: "uncommitted" | "committed",
): WorkspaceChangedFilesSection<WorkspaceFileStatus> | undefined {
  return selectWorkspaceChangedFilesSections(workspaceStatus).find((candidate) =>
    kind === "committed"
      ? candidate.kind === "committed"
      : candidate.kind !== "committed",
  );
}

export type ChangedFileOpen =
  | { kind: "diff" }
  | { kind: "preview"; ref: string | undefined };

export function resolveChangedFileOpen({
  file,
  section,
}: WorkspaceChangedFileSelection<WorkspaceFileStatus>): ChangedFileOpen {
  if (file.status === "A" || file.status === "??") {
    return { kind: "preview", ref: undefined };
  }
  if (file.status !== "D") return { kind: "diff" };
  if (section.kind !== "committed") return { kind: "preview", ref: "HEAD" };
  return section.mergeBaseRef
    ? { kind: "preview", ref: section.mergeBaseRef }
    : { kind: "diff" };
}

export interface ChangedFileActions {
  onChangedFileClick(selection: WorkspaceChangedFileSelection<WorkspaceFileStatus>): void;
  onOpenChangedFile(path: string): void;
  onCommitClick(sha: string): void;
}

export function useChangedFileActions(
  environmentId: string,
): ChangedFileActions {
  const panel = useAppPanel();
  const navigate = useBbNavigate();
  const openDiff = useCallback(
    (target: { kind: "file"; path: string } | { kind: "commit"; sha: string }) =>
      panel.openTab({
        tab: {
          id: GIT_DIFF_TAB_ID,
          context: { kind: "thread" },
          availability: "fixed",
        },
        target,
      }),
    [panel],
  );
  const onOpenChangedFile = useCallback(
    (path: string) => {
      navigate.experimental_openFilePreview({
        target: { kind: "workspace", environmentId, path },
        location: null,
      });
    },
    [environmentId, navigate],
  );
  const onChangedFileClick = useCallback(
    (selection: WorkspaceChangedFileSelection<WorkspaceFileStatus>) => {
      const open = resolveChangedFileOpen(selection);
      if (open.kind === "diff") {
        openDiff({ kind: "file", path: selection.file.path });
        return;
      }
      navigate.experimental_openFilePreview({
        target: {
          kind: "workspace",
          environmentId,
          path: selection.file.path,
          ...(open.ref === undefined ? {} : { experimental_ref: open.ref }),
        },
        location: null,
      });
    },
    [environmentId, navigate, openDiff],
  );
  const onCommitClick = useCallback(
    (sha: string) => {
      openDiff({ kind: "commit", sha });
    },
    [openDiff],
  );
  return { onChangedFileClick, onOpenChangedFile, onCommitClick };
}

export function ChangedFilesTally({
  section,
}: {
  section: WorkspaceChangedFilesSection<WorkspaceFileStatus>;
}) {
  const tally = toChangeTally(section.stats);
  if (!tally.lineStatsComplete) return null;
  return (
    <DiffStatsTally
      insertions={tally.insertions}
      deletions={tally.deletions}
      className="text-2xs tabular-nums"
    />
  );
}

function ChangedFileRow({
  file,
  section,
  actions,
}: {
  file: WorkspaceFileStatus;
  section: WorkspaceChangedFilesSection<WorkspaceFileStatus>;
  actions: ChangedFileActions;
}) {
  const glyph = FILE_STATUS_GLYPHS[file.status];
  const lineStats =
    file.insertions !== null &&
    file.deletions !== null &&
    file.insertions + file.deletions > 0
      ? { insertions: file.insertions, deletions: file.deletions }
      : null;
  const select = () => actions.onChangedFileClick({ file, section });
  const context = folderHint(file.path);
  return (
    <InfoListRow
      leading={
        <Icon
          name={glyph.icon}
          className={cn("size-3", glyph.className)}
          aria-hidden
        />
      }
      leadingLabel={glyph.label}
      name={fileName(file.path)}
      {...(context === undefined ? {} : { context })}
      title={`${glyph.label} · ${file.path}`}
      target={{ kind: "button", onSelect: select }}
      actions={
        file.status !== "D"
          ? [
              {
                icon: "ExternalLink",
                label: "Open file in tab",
                onSelect: () => actions.onOpenChangedFile(file.path),
              },
            ]
          : []
      }
      trailing={
        lineStats ? (
          <span
            onClick={select}
            className="group/diff relative z-10 -mr-1 -ml-2 flex h-full min-w-16 shrink-0 cursor-pointer items-center justify-end pr-1 pl-2"
          >
            <DiffSizeBar
              {...lineStats}
              className="group-hover/diff:hidden group-focus-within:hidden"
            />
            <DiffStatsTally
              {...lineStats}
              hideZero
              className="sr-only text-2xs tabular-nums group-hover/diff:not-sr-only group-focus-within:not-sr-only"
            />
          </span>
        ) : null
      }
    />
  );
}

export function ChangedFilesList({
  section,
  actions,
}: {
  section: WorkspaceChangedFilesSection<WorkspaceFileStatus>;
  actions: ChangedFileActions;
}) {
  const omittedFilesLabel = formatOmittedChangedFilesLabel(section.stats);
  return (
    <>
      <InfoList
        items={section.files}
        getKey={(file) => `${file.status}:${file.path}`}
        renderItem={(file) => (
          <ChangedFileRow file={file} section={section} actions={actions} />
        )}
      />
      {omittedFilesLabel ? (
        <p className="m-0 text-2xs leading-6 text-subtle-foreground">
          {omittedFilesLabel}
        </p>
      ) : null}
    </>
  );
}
