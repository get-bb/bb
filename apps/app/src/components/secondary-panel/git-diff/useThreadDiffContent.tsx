import { useMemo, useState } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Button } from "@bb/shared-ui/button";
import {
  DEFAULT_DIFF_FILE_FILTERS,
  filterDiffFiles,
  diffExtensionCounts,
} from "./diff-file-filters";
import {
  useEnvironmentDiffFiles,
  useEnvironmentDiffViewed,
} from "@/hooks/queries/environment-queries";
import {
  useGitDiffIgnoreWhitespacePreference,
  useGitDiffLineOverflowModePreference,
} from "@/lib/git-diff-view-preferences";
import { useGitDiffPanelState } from "./useGitDiffPanelState";
import {
  summarizeDiffFileEntries,
  useDiffFilesCollapseControls,
} from "./diffFilesStore";
import { buildGitDiffIdentity } from "./gitDiffPanelHelpers";
import {
  GitDiffToolbar,
  type GitDiffDisplayMode,
  type GitDiffDisplayModeChangeHandler,
} from "../GitDiffToolbar";
import {
  GitDiffLoadingSkeleton,
  GitDiffTabContent,
} from "../ThreadSecondaryPanelTabContent";
import type { DiffPresentation } from "@/components/code/code-rendering";
import type { ThreadSecondaryPanelProps } from "../ThreadSecondaryPanel";
import type { GitDiffTabStatus } from "../gitDiffTabEligibility";
import type { DiffFileEntry } from "bb-plugin-bb--git/contract";

const EMPTY_DIFF_FILES: readonly DiffFileEntry[] = [];

type ThreadDiffContentProps = Pick<
  ThreadSecondaryPanelProps,
  | "environmentId"
  | "requestedMergeBaseBranch"
  | "onClearPendingGitDiffIntent"
  | "pendingGitDiffCommitSha"
  | "pendingGitDiffScrollPath"
  | "onRetryGitDiffEligibility"
  | "onOpenFileInEditor"
  | "onOpenFilePreview"
  | "onSelectionAddToChat"
  | "workspaceRootPath"
> & {
  toolbarClassName: string;
  isDiffPanelLive: boolean;
  isLayoutOpen: boolean;
  resolvedGitDiffTabStatus: GitDiffTabStatus;
  gitDiffDisplayMode: GitDiffDisplayMode;
  handleGitDiffDisplayModeChange: GitDiffDisplayModeChangeHandler;
};

export function useThreadDiffContent({
  toolbarClassName,
  environmentId,
  requestedMergeBaseBranch,
  onClearPendingGitDiffIntent,
  pendingGitDiffCommitSha,
  pendingGitDiffScrollPath,
  onRetryGitDiffEligibility,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  workspaceRootPath,
  isDiffPanelLive,
  isLayoutOpen,
  resolvedGitDiffTabStatus,
  gitDiffDisplayMode,
  handleGitDiffDisplayModeChange,
}: ThreadDiffContentProps) {
  const {
    gitDiffFileFilter,
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
    setGitDiffFileFilter,
  } = useGitDiffPanelState({
    environmentId,
    isDiffPanelActive: isDiffPanelLive,
    requestedMergeBaseBranch,
    onClearPendingGitDiffIntent,
    pendingGitDiffCommitSha,
    pendingGitDiffScrollPath,
  });
  const [gitDiffIgnoreWhitespace, setGitDiffIgnoreWhitespace] =
    useGitDiffIgnoreWhitespacePreference();
  const { data: diffFilesResponse, isLoading: isDiffFilesLoading } =
    useEnvironmentDiffFiles(environmentId ?? "", {
      enabled:
        isDiffPanelLive &&
        Boolean(environmentId) &&
        gitDiffTarget !== undefined,
      target: gitDiffTarget,
      ignoreWhitespace: gitDiffIgnoreWhitespace,
    });
  const diffFiles =
    diffFilesResponse?.outcome === "available"
      ? diffFilesResponse.files
      : EMPTY_DIFF_FILES;
  const diffMergeBaseRef =
    diffFilesResponse?.outcome === "available"
      ? diffFilesResponse.mergeBaseRef
      : null;
  const isGitDiffTruncated =
    diffFilesResponse?.outcome === "available" && diffFilesResponse.truncated;
  const diffIdentity = useMemo(
    () =>
      buildGitDiffIdentity({
        environmentId,
        mergeBaseRef: diffMergeBaseRef,
        target: gitDiffTarget,
      }),
    [diffMergeBaseRef, environmentId, gitDiffTarget],
  );
  const [gitDiffFilters, setGitDiffFilters] = useState(
    DEFAULT_DIFF_FILE_FILTERS,
  );
  const { data: diffViewedResponse } = useEnvironmentDiffViewed(
    environmentId ?? "",
    {
      target: gitDiffTarget,
      enabled: isDiffPanelLive,
      paths: diffFiles.map((file) => file.path),
    },
  );
  const viewedRevisionByPath = useMemo(
    () =>
      new Map(
        (diffViewedResponse?.files ?? []).map((file) => [
          file.path,
          file.revision,
        ]),
      ),
    [diffViewedResponse],
  );
  const extensionCounts = useMemo(
    () => diffExtensionCounts(diffFiles),
    [diffFiles],
  );
  const filteredDiffFiles = useMemo(
    () =>
      filterDiffFiles(
        diffFiles,
        gitDiffFileFilter ?? "",
        gitDiffFilters,
        viewedRevisionByPath,
      ),
    [diffFiles, gitDiffFileFilter, gitDiffFilters, viewedRevisionByPath],
  );
  const gitDiffStats = useMemo(
    () => summarizeDiffFileEntries(filteredDiffFiles),
    [filteredDiffFiles],
  );
  const { areAllCollapsed, toggleAllCollapsed, hasFiles } =
    useDiffFilesCollapseControls(
      diffIdentity,
      filteredDiffFiles,
      diffFiles.length,
    );
  const [gitDiffLineOverflowMode, setGitDiffLineOverflowMode] =
    useGitDiffLineOverflowModePreference();
  const gitDiffPresentation = useMemo<DiffPresentation>(
    () => ({
      view: gitDiffDisplayMode,
      overflow: gitDiffLineOverflowMode,
      showLineNumbers: true,
    }),
    [gitDiffDisplayMode, gitDiffLineOverflowMode],
  );
  const pending =
    resolvedGitDiffTabStatus === "loading" ||
    resolvedGitDiffTabStatus === "error";
  return (
    <>
      {resolvedGitDiffTabStatus === "eligible" ? (
        <div className={toolbarClassName}>
          <GitDiffToolbar
            selectionValue={gitDiffSelectValue}
            selectionOptions={gitDiffSelectOptions}
            onSelectionChange={onGitDiffSelectionChange}
            isSelectorDisabled={
              isDiffFilesLoading || gitDiffTarget === undefined
            }
            stats={gitDiffStats}
            isStatsLoading={isDiffFilesLoading || gitDiffTarget === undefined}
            totalFilesCount={diffFiles.length}
            isTruncated={isGitDiffTruncated}
            fileFilter={gitDiffFileFilter}
            filters={gitDiffFilters}
            onFiltersChange={setGitDiffFilters}
            extensionCounts={extensionCounts}
            onFileFilterChange={setGitDiffFileFilter}
            areAllFilesCollapsed={areAllCollapsed}
            isCollapseAllDisabled={!hasFiles || isDiffFilesLoading}
            collapseAllDisabledReason={
              isDiffFilesLoading
                ? null
                : diffFiles.length === 0
                  ? "No changes"
                  : !hasFiles
                    ? "No files match filter"
                    : null
            }
            onToggleAllCollapsed={toggleAllCollapsed}
            displayMode={gitDiffDisplayMode}
            onDisplayModeChange={handleGitDiffDisplayModeChange}
            lineOverflowMode={gitDiffLineOverflowMode}
            onLineOverflowModeChange={setGitDiffLineOverflowMode}
            ignoreWhitespace={gitDiffIgnoreWhitespace}
            onIgnoreWhitespaceChange={setGitDiffIgnoreWhitespace}
          />
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {pending ? (
          resolvedGitDiffTabStatus === "error" ? (
            <EmptyStatePanel className="m-4 rounded-lg" role="status">
              <div className="flex flex-col items-center gap-3 text-center">
                <span>
                  Could not determine whether this workspace uses Git.
                </span>
                {onRetryGitDiffEligibility ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRetryGitDiffEligibility}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            </EmptyStatePanel>
          ) : (
            <GitDiffLoadingSkeleton />
          )
        ) : resolvedGitDiffTabStatus === "eligible" ? (
          <GitDiffTabContent
            environmentId={environmentId}
            target={gitDiffTarget}
            isPanelOpen={isLayoutOpen}
            gitDiffPresentation={gitDiffPresentation}
            ignoreWhitespace={gitDiffIgnoreWhitespace}
            fileFilter={gitDiffFileFilter ?? ""}
            filters={gitDiffFilters}
            onClearPendingGitDiffIntent={onClearPendingGitDiffIntent}
            onOpenFileInEditor={onOpenFileInEditor}
            onOpenFilePreview={onOpenFilePreview}
            onSelectionAddToChat={onSelectionAddToChat}
            pendingGitDiffScrollPath={pendingGitDiffScrollPath}
            workspaceRootPath={workspaceRootPath}
          />
        ) : null}
      </div>
    </>
  );
}
