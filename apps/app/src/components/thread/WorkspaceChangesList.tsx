import type { WorkspaceStatus } from "@bb/domain";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { FilePathLink } from "@/components/ui/file-path-link.js";
import { cn } from "@/lib/utils";
import { formatWorkspaceFileStatus } from "@/components/workspace/workspace-change-summary";

export type WorkspaceChangedFile =
  WorkspaceStatus["workingTree"]["files"][number];

export type WorkspaceChangedFileClickHandler = (
  file: WorkspaceChangedFile,
) => void;

export interface WorkspaceChangesListProps {
  files: readonly WorkspaceChangedFile[];
  className?: string;
  emptyMessage?: string;
  onFileClick?: WorkspaceChangedFileClickHandler;
}

interface WorkspaceChangesListItemProps {
  file: WorkspaceChangedFile;
  onFileClick?: WorkspaceChangedFileClickHandler;
}

const WORKSPACE_CHANGE_ROW_CLASS =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3";

function WorkspaceChangesListItem({
  file,
  onFileClick,
}: WorkspaceChangesListItemProps) {
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
    return <li className={WORKSPACE_CHANGE_ROW_CLASS}>{rowContent}</li>;
  }

  return (
    <li>
      <button
        type="button"
        className={cn(
          WORKSPACE_CHANGE_ROW_CLASS,
          "group w-full rounded px-1 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        title={file.path}
        aria-label={`Open ${file.path}`}
        onClick={() => onFileClick(file)}
      >
        {rowContent}
      </button>
    </li>
  );
}

export function WorkspaceChangesList({
  files,
  className = "max-h-32",
  emptyMessage = "No changed files detected.",
  onFileClick,
}: WorkspaceChangesListProps) {
  if (!files || files.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <ul className={cn("space-y-1 overflow-auto", className)}>
      {files.map((file) => (
        <WorkspaceChangesListItem
          key={`${file.status}:${file.path}`}
          file={file}
          onFileClick={onFileClick}
        />
      ))}
    </ul>
  );
}
