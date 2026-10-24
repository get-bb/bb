import { DiffStatsTally } from "./diff-stats-tally";
import { EmptyState } from "./empty-state";
import { FilePathLink } from "./file-path-link";
import { cn } from "../../lib/utils";
import {
  formatOmittedChangedFilesLabel,
  formatWorkspaceFileStatus,
  type WorkspaceChangedFileStatus,
} from "./workspace-change-summary";

export type WorkspaceChangedFile = WorkspaceChangedFileStatus;

type WorkspaceChangedFileClickHandler<File> = (file: File) => void;

interface WorkspaceChangesListProps<File extends WorkspaceChangedFile> {
  files: File[];
  fileCount: number;
  className?: string;
  onFileClick?: WorkspaceChangedFileClickHandler<File>;
}

interface WorkspaceChangesListItemProps<File extends WorkspaceChangedFile> {
  file: File;
  onFileClick?: WorkspaceChangedFileClickHandler<File>;
}

const WORKSPACE_CHANGE_ROW_CLASS =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3";

function fileKey(file: WorkspaceChangedFile): string {
  return `${file.status}:${file.path}`;
}

function WorkspaceChangesListItem<File extends WorkspaceChangedFile>({
  file,
  onFileClick,
}: WorkspaceChangesListItemProps<File>) {
  const rowContent = (
    <>
      <span className="text-xs leading-5 text-muted-foreground opacity-70">
        {formatWorkspaceFileStatus(file.status)}
      </span>
      <FilePathLink
        path={file.path}
        className={cn(
          "opacity-70",
          onFileClick ? "group-hover:underline" : undefined,
        )}
      />
      {file.insertions !== null && file.deletions !== null ? (
        <DiffStatsTally
          insertions={file.insertions}
          deletions={file.deletions}
          hideZero
          className="text-xs leading-5"
        />
      ) : null}
    </>
  );

  if (!onFileClick) {
    return <div className={WORKSPACE_CHANGE_ROW_CLASS}>{rowContent}</div>;
  }

  return (
    <button
      type="button"
      className={cn(
        WORKSPACE_CHANGE_ROW_CLASS,
        "group w-full rounded px-1 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label={`Open ${file.path}`}
      onClick={() => onFileClick(file)}
    >
      {rowContent}
    </button>
  );
}

export function WorkspaceChangesList<File extends WorkspaceChangedFile>({
  files,
  fileCount,
  className = "max-h-32",
  onFileClick,
}: WorkspaceChangesListProps<File>) {
  if (files.length === 0) {
    return <EmptyState message="No changed files detected." />;
  }

  const omittedFilesLabel = formatOmittedChangedFilesLabel({
    fileCount,
    files,
  });

  return (
    <ul className={cn("space-y-1 overflow-auto", className)}>
      {files.map((file) => (
        <li key={fileKey(file)}>
          <WorkspaceChangesListItem file={file} onFileClick={onFileClick} />
        </li>
      ))}
      {omittedFilesLabel ? (
        <li className="px-1 text-xs leading-5 text-muted-foreground">
          {omittedFilesLabel}
        </li>
      ) : null}
    </ul>
  );
}
