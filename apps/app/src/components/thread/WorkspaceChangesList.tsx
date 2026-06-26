import type { WorkspaceStatus } from "@bb/domain";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { FilePathLink } from "@/components/ui/file-path-link.js";
import { TruncatedList } from "@/components/ui/truncated-list.js";
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
  /**
   * When set, the list caps at `limit` files behind a "Show N more" / "Show
   * less" toggle (like the Commits list) instead of the default scrollable
   * box. `className` is ignored in this mode — the rollup sizes to content.
   */
  limit?: number;
}

interface WorkspaceChangesListItemProps {
  file: WorkspaceChangedFile;
  onFileClick?: WorkspaceChangedFileClickHandler;
}

const WORKSPACE_CHANGE_ROW_CLASS =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3";

function fileKey(file: WorkspaceChangedFile): string {
  return `${file.status}:${file.path}`;
}

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

export function WorkspaceChangesList({
  files,
  className = "max-h-32",
  emptyMessage = "No changed files detected.",
  onFileClick,
  limit,
}: WorkspaceChangesListProps) {
  if (!files || files.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  if (limit !== undefined) {
    return (
      <TruncatedList
        items={files}
        getKey={fileKey}
        limit={limit}
        renderItem={(file) => (
          <WorkspaceChangesListItem file={file} onFileClick={onFileClick} />
        )}
      />
    );
  }

  return (
    <ul className={cn("space-y-1 overflow-auto", className)}>
      {files.map((file) => (
        <li key={fileKey(file)}>
          <WorkspaceChangesListItem file={file} onFileClick={onFileClick} />
        </li>
      ))}
    </ul>
  );
}
