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

type ChangesSectionKind = "uncommitted" | "committed";

const CHANGES_SECTION_COPY: Record<
  ChangesSectionKind,
  { id: string; label: string }
> = {
  uncommitted: { id: "uncommittedChanges", label: "Uncommitted changes" },
  committed: { id: "committedChanges", label: "Committed changes" },
};

interface ChangesSectionProps {
  kind: ChangesSectionKind;
  workspaceStatus: WorkspaceStatus | undefined;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  onOpenChangedFile?: (path: string) => void;
}

export function ChangesSection({
  kind,
  workspaceStatus,
  onChangedFileClick,
  onOpenChangedFile,
}: ChangesSectionProps) {
  const copy = CHANGES_SECTION_COPY[kind];
  const collapse = useInfoSectionCollapse(copy.id);
  const section = selectWorkspaceChangedFilesSections(workspaceStatus).find(
    (candidate) =>
      kind === "committed"
        ? candidate.kind === "committed"
        : candidate.kind !== "committed",
  );
  if (section === undefined) return null;
  const tally = toChangeTally(section.stats);
  return (
    <InfoSection
      label={copy.label}
      count={section.files.length}
      collapse={collapse}
      trailing={
        tally.lineStatsComplete ? (
          <DiffStatsTally
            insertions={tally.insertions}
            deletions={tally.deletions}
            className="text-2xs tabular-nums"
          />
        ) : null
      }
    >
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
