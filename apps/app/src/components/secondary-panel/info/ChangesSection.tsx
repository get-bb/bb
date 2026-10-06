import type { WorkspaceFileStatus, WorkspaceStatus } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DiffSizeBar,
  DiffStatsTally,
} from "@/components/ui/diff-stats-tally.js";
import {
  ChangedFilesBucketMenu,
  useChangedFilesBucket,
} from "./ChangedFilesBucketMenu";
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
import {
  InfoList,
  InfoListRow,
  InfoMenuTrigger,
  InfoSection,
} from "./info-list";

interface ChangesSectionProps {
  workspaceStatus: WorkspaceStatus | undefined;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  onOpenChangedFile?: (path: string) => void;
}

export function ChangesSection({
  workspaceStatus,
  onChangedFileClick,
  onOpenChangedFile,
}: ChangesSectionProps) {
  const sections = selectWorkspaceChangedFilesSections(workspaceStatus);
  const { activeSection, selectKind } = useChangedFilesBucket(sections);
  if (activeSection === undefined) return null;
  const tally = toChangeTally(activeSection.stats);
  return (
    <InfoSection
      label="Changes"
      count={activeSection.files.length}
      accessory={
        sections.length > 1 ? (
          <ChangedFilesBucketMenu
            sections={sections}
            activeSection={activeSection}
            onSelect={selectKind}
            trigger={
              <InfoMenuTrigger aria-label="Switch changed files bucket">
                {activeSection.label}
              </InfoMenuTrigger>
            }
          />
        ) : (
          <span className="ml-1.5 text-2xs text-subtle-foreground">
            {activeSection.label}
          </span>
        )
      }
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
        items={activeSection.files}
        getKey={(file) => `${file.status}:${file.path}`}
        renderItem={(file) => (
          <ChangedFileRow
            file={file}
            section={activeSection}
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
