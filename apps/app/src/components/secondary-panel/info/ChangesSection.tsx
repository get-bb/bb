import type { WorkspaceFileStatus, WorkspaceStatus } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DiffSizeBar,
  DiffStatsTally,
} from "@/components/ui/diff-stats-tally.js";
import {
  selectWorkspaceChangedFilesSections,
  toChangeTally,
  type WorkspaceChangedFileSelection,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import {
  getFileNameFromPath,
  getParentFolderNameFromPath,
} from "../rightPanelFileVisuals";
import { FILE_STATUS_GLYPHS } from "./file-status-glyphs";
import { InfoList, InfoListRow, InfoSection } from "./info-list";
import { useInfoSectionCollapse } from "./useInfoSectionCollapse";

interface ChangedFilesHandlers {
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  onOpenChangedFile?: (path: string) => void;
}

export function selectChangedFilesSection(
  workspaceStatus: WorkspaceStatus | undefined,
  kind: "uncommitted" | "committed",
): WorkspaceChangedFilesSection | undefined {
  return selectWorkspaceChangedFilesSections(workspaceStatus).find(
    (candidate) =>
      kind === "committed"
        ? candidate.kind === "committed"
        : candidate.kind !== "committed",
  );
}

export function ChangedFilesTally({
  section,
}: {
  section: WorkspaceChangedFilesSection;
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

export function ChangedFilesList({
  section,
  onChangedFileClick,
  onOpenChangedFile,
}: ChangedFilesHandlers & { section: WorkspaceChangedFilesSection }) {
  return (
    <InfoList
      items={section.files}
      getKey={(file) => `${file.status}:${file.path}`}
      renderItem={(file) => (
        <ChangedFileRow
          file={file}
          section={section}
          onChangedFileClick={onChangedFileClick}
          onOpenChangedFile={onOpenChangedFile}
        />
      )}
    />
  );
}

export function UncommittedChangesSection({
  workspaceStatus,
  onChangedFileClick,
  onOpenChangedFile,
}: ChangedFilesHandlers & { workspaceStatus: WorkspaceStatus | undefined }) {
  const collapse = useInfoSectionCollapse("uncommittedChanges");
  const section = selectChangedFilesSection(workspaceStatus, "uncommitted");
  if (section === undefined) return null;
  return (
    <InfoSection
      label="Uncommitted files"
      count={section.files.length}
      collapse={collapse}
      trailing={<ChangedFilesTally section={section} />}
    >
      <ChangedFilesList
        section={section}
        onChangedFileClick={onChangedFileClick}
        onOpenChangedFile={onOpenChangedFile}
      />
    </InfoSection>
  );
}

function ChangedFileRow({
  file,
  section,
  onChangedFileClick,
  onOpenChangedFile,
}: {
  file: WorkspaceFileStatus;
  section: WorkspaceChangedFilesSection;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  onOpenChangedFile?: (path: string) => void;
}) {
  const glyph = FILE_STATUS_GLYPHS[file.status];
  const fileName = getFileNameFromPath({ path: file.path });
  const lineStats =
    file.insertions !== null &&
    file.deletions !== null &&
    file.insertions + file.deletions > 0
      ? { insertions: file.insertions, deletions: file.deletions }
      : null;
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
      name={fileName}
      context={getParentFolderNameFromPath({ path: file.path })}
      title={`${glyph.label} · ${file.path}`}
      target={
        onChangedFileClick
          ? {
              kind: "button",
              onSelect: () => onChangedFileClick({ file, section }),
            }
          : null
      }
      actions={
        onOpenChangedFile && file.status !== "D"
          ? [
              {
                icon: "ExternalLink",
                label: "Open in tab",
                onSelect: () => onOpenChangedFile(file.path),
              },
            ]
          : []
      }
      trailing={
        lineStats ? (
          <span className="flex shrink-0 items-center">
            <DiffSizeBar {...lineStats} className="group-hover:hidden" />
            <DiffStatsTally
              {...lineStats}
              hideZero
              className="sr-only text-2xs tabular-nums group-hover:not-sr-only"
            />
          </span>
        ) : null
      }
    />
  );
}
