import { useState } from "react";
import type {
  Thread,
  ThreadListEntry,
  WorkspaceFileStatusKind,
  WorkspaceStatus,
} from "@bb/domain";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DiffSizeBar,
  DiffStatsTally,
} from "@/components/ui/diff-stats-tally.js";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import {
  selectWorkspaceAheadCommits,
  selectWorkspaceChangedFilesSections,
  toChangeTally,
  type WorkspaceChangedFileSelection,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import { useThreads } from "@/hooks/queries/thread-queries";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  describeLifecycleError,
  formatLifecycleErrorDescription,
} from "@/lib/lifecycle-errors";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  InfoCountPill,
  InfoList,
  InfoListRow,
  InfoRowAction,
  InfoRowTime,
  InfoSectionHeading,
} from "./info-panel-list";
import { resolveRightPanelFileIconName } from "./rightPanelFileVisuals";
import type { ThreadStorageBrowserController } from "./useThreadStorageBrowser";

interface FileStatusGlyph {
  icon: IconName;
  label: string;
  className: string;
}

const FILE_STATUS_GLYPHS: Record<WorkspaceFileStatusKind, FileStatusGlyph> = {
  M: {
    icon: "DiffModified",
    label: "Modified",
    className: "text-subtle-foreground",
  },
  A: { icon: "DiffAdded", label: "Added", className: "text-diff-added" },
  "??": { icon: "DiffAdded", label: "Untracked", className: "text-diff-added" },
  D: { icon: "DiffRemoved", label: "Deleted", className: "text-diff-removed" },
  R: {
    icon: "DiffRenamed",
    label: "Renamed",
    className: "text-subtle-foreground",
  },
  C: { icon: "Copy", label: "Copied", className: "text-subtle-foreground" },
  U: { icon: "DiffConflict", label: "Conflict", className: "text-destructive" },
  "?": {
    icon: "CircleQuestion",
    label: "Unknown",
    className: "text-subtle-foreground",
  },
};

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function parentFolderOf(path: string): string | null {
  const segments = path.split("/");
  return segments.length > 1 ? (segments[segments.length - 2] ?? null) : null;
}

interface RelatedThreadsSectionProps {
  label: string;
  threads: readonly ThreadListEntry[];
  now: number;
}

function RelatedThreadsSection({
  label,
  threads,
  now,
}: RelatedThreadsSectionProps) {
  if (threads.length === 0) return null;
  return (
    <section>
      <InfoSectionHeading label={label} count={threads.length} />
      <InfoList
        items={threads}
        getKey={(relatedThread) => relatedThread.id}
        renderItem={(relatedThread) => {
          const title = getThreadDisplayTitle(relatedThread);
          return (
            <InfoListRow
              slot={
                <span className="flex items-center text-subtle-foreground [&_[data-icon-root]]:size-3">
                  <ThreadStatusGlyph
                    {...threadListIndicatorStateForThread(relatedThread, false)}
                    size="compact"
                  />
                </span>
              }
              name={<ThreadTitle title={title} />}
              title={title}
              target={{
                kind: "link",
                to: getThreadRoutePath({
                  projectId: relatedThread.projectId,
                  threadId: relatedThread.id,
                }),
              }}
              meta={
                <InfoRowTime timestamp={relatedThread.updatedAt} now={now} />
              }
            />
          );
        }}
      />
    </section>
  );
}

export function ForksSection({ thread, now }: { thread: Thread; now: number }) {
  const forksQuery = useThreads({
    projectId: thread.projectId,
    sourceThreadId: thread.id,
    originKind: "fork",
    archived: false,
  });
  return (
    <RelatedThreadsSection
      label="Forks"
      threads={forksQuery.data ?? []}
      now={now}
    />
  );
}

interface CommitsSectionProps {
  workspaceStatus: WorkspaceStatus | undefined;
  onCommitClick?: (sha: string) => void;
  now: number;
}

export function CommitsSection({
  workspaceStatus,
  onCommitClick,
  now,
}: CommitsSectionProps) {
  const commits = selectWorkspaceAheadCommits(workspaceStatus);
  if (commits.length === 0) return null;
  return (
    <section>
      <InfoSectionHeading label="Commits" count={commits.length} />
      <InfoList
        items={commits}
        rail
        getKey={(commit) => commit.sha}
        renderItem={(commit) => (
          <InfoListRow
            slot={
              <span className="size-[7px] rounded-full border border-subtle-foreground/60 bg-background group-hover:border-subtle-foreground" />
            }
            name={commit.subject}
            title={commit.subject}
            target={
              onCommitClick
                ? { kind: "button", onSelect: () => onCommitClick(commit.sha) }
                : null
            }
            action={
              <InfoRowAction
                icon="Copy"
                label={`Copy commit ${commit.shortSha} SHA`}
                onClick={() => {
                  void copyToClipboardWithToast(commit.sha, {
                    successMessage: "Commit SHA copied",
                    errorMessage: "Failed to copy commit SHA",
                  });
                }}
              />
            }
            meta={
              <InfoRowTime
                timestamp={commit.authoredAt}
                now={now}
                detail={`${commit.shortSha} · ${commit.authorName}`}
              />
            }
          />
        )}
      />
    </section>
  );
}

function ChangesBucketSwitcher({
  sections,
  activeSection,
  onSelect,
}: {
  sections: readonly WorkspaceChangedFilesSection[];
  activeSection: WorkspaceChangedFilesSection;
  onSelect: (kind: WorkspaceChangedFilesSection["kind"]) => void;
}) {
  if (sections.length < 2) {
    return (
      <span className="ml-1.5 text-2xs font-normal text-subtle-foreground">
        {activeSection.label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Switch changed files bucket"
          className="ml-1 h-5 gap-0.5 rounded-sm px-1 text-2xs font-normal text-subtle-foreground shadow-none hover:text-foreground"
        >
          {activeSection.label}
          <Icon name="ChevronDown" className="size-3" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {sections.map((option) => (
          <DropdownMenuItem
            key={option.kind}
            onSelect={() => onSelect(option.kind)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{option.label}</span>
            <Icon
              name="Check"
              className={cn(
                "size-3.5 shrink-0",
                option.kind === activeSection.kind
                  ? "opacity-100"
                  : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  const [selectedKind, setSelectedKind] = useState<
    WorkspaceChangedFilesSection["kind"] | null
  >(null);
  const sections = selectWorkspaceChangedFilesSections(workspaceStatus);
  const activeSection =
    sections.find((candidate) => candidate.kind === selectedKind) ??
    sections[0];
  if (activeSection === undefined) return null;
  const tally = toChangeTally(activeSection.stats);
  return (
    <section>
      <InfoSectionHeading
        label={
          <>
            Changes
            <InfoCountPill count={activeSection.files.length} />
            <ChangesBucketSwitcher
              sections={sections}
              activeSection={activeSection}
              onSelect={setSelectedKind}
            />
          </>
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
      />
      <InfoList
        items={activeSection.files}
        getKey={(file) => `${file.status}:${file.path}`}
        renderItem={(file) => {
          const glyph = FILE_STATUS_GLYPHS[file.status];
          const hasLineStats =
            file.insertions !== null &&
            file.deletions !== null &&
            file.insertions + file.deletions > 0;
          return (
            <InfoListRow
              slot={
                <Icon
                  name={glyph.icon}
                  className={cn("size-3", glyph.className)}
                  aria-label={glyph.label}
                />
              }
              name={fileNameOf(file.path)}
              context={parentFolderOf(file.path)}
              title={`${glyph.label} · ${file.path}`}
              target={
                onChangedFileClick
                  ? {
                      kind: "button",
                      onSelect: () =>
                        onChangedFileClick({ file, section: activeSection }),
                    }
                  : null
              }
              action={
                onOpenChangedFile && file.status !== "D" ? (
                  <InfoRowAction
                    icon="ArrowUpRight"
                    label={`Open ${fileNameOf(file.path)}`}
                    onClick={() => onOpenChangedFile(file.path)}
                  />
                ) : null
              }
              meta={
                hasLineStats ? (
                  <span className="flex shrink-0 items-center">
                    <DiffSizeBar
                      insertions={file.insertions ?? 0}
                      deletions={file.deletions ?? 0}
                      className="group-hover:hidden"
                    />
                    <DiffStatsTally
                      insertions={file.insertions ?? 0}
                      deletions={file.deletions ?? 0}
                      hideZero
                      className="sr-only text-2xs tabular-nums group-hover:not-sr-only"
                    />
                  </span>
                ) : null
              }
            />
          );
        }}
      />
    </section>
  );
}

export interface ThreadStorageSectionProps {
  controller: ThreadStorageBrowserController;
  filesError?: Error | null;
  isFilesLoading: boolean;
}

function describeStorageError(error: Error): string {
  const lifecycleErrorDescription = describeLifecycleError({
    error,
    operation: "load_thread_storage",
  });
  return (
    (lifecycleErrorDescription
      ? formatLifecycleErrorDescription(lifecycleErrorDescription)
      : null) ??
    getMutationErrorMessage({
      error,
      fallbackMessage: "Failed to load thread storage",
      lifecycleOperation: "load_thread_storage",
    })
  );
}

export function ThreadStorageSection({
  controller,
  filesError,
  isFilesLoading,
}: ThreadStorageSectionProps) {
  const {
    closeSearch,
    filteredFiles,
    isSearchOpen,
    loadedFiles,
    openSearch,
    searchQuery,
    selectedPath,
    selectPath,
    setSearchQuery,
  } = controller;
  if (loadedFiles.length === 0 && filesError == null) return null;
  return (
    <section>
      <InfoSectionHeading
        label="Thread storage"
        count={loadedFiles.length}
        trailing={
          isSearchOpen ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Search files"
              onClick={openSearch}
              className="size-5 shrink-0 text-subtle-foreground hover:text-foreground [&_[data-icon-root]]:size-3"
            >
              <Icon name="Search" />
            </Button>
          )
        }
      />
      {isSearchOpen ? (
        <div className="mb-1 flex h-7 items-center gap-1">
          <Input
            autoFocus
            aria-label="Search files"
            placeholder="Search files"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
            className="h-7 text-xs focus-visible:ring-0"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close search"
            onClick={closeSearch}
            className="size-6 shrink-0 text-subtle-foreground [&_[data-icon-root]]:size-3"
          >
            <Icon name="X" />
          </Button>
        </div>
      ) : null}
      {filesError ? (
        <EmptyState
          message={describeStorageError(filesError)}
          messageClassName="text-destructive"
        />
      ) : isFilesLoading && loadedFiles.length === 0 ? (
        <EmptyState
          icon="Spinner"
          message="Loading files..."
          iconClassName="animate-spin"
        />
      ) : filteredFiles.length === 0 ? (
        <EmptyState message="No files match search." />
      ) : (
        <InfoList
          items={filteredFiles}
          getKey={(file) => file.path}
          renderItem={(file) => (
            <InfoListRow
              slot={
                <Icon
                  name={resolveRightPanelFileIconName(file.path)}
                  className="size-3 text-subtle-foreground"
                  aria-hidden
                />
              }
              name={fileNameOf(file.path)}
              context={parentFolderOf(file.path)}
              title={file.path}
              selected={selectedPath === file.path}
              target={{ kind: "button", onSelect: () => selectPath(file.path) }}
            />
          )}
        />
      )}
    </section>
  );
}
