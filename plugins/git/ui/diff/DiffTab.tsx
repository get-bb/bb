import { useCallback, useMemo, useRef, useState } from "react";
import { useResizeObserver } from "usehooks-ts";
import {
  experimental_useFixedTabTarget as useFixedTabTarget,
  experimental_useCanOpenFileExternally as useCanOpenFileExternally,
  useBbNavigate,
  type ExperimentalThreadEnvironmentState,
  type ExperimentalThreadFixedTabProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import type { DiffPresentation } from "@bb/shared-ui/git-diff/renderers";
import type { DiffFileEntry } from "../../contract.js";
import { GIT_DIFF_TAB_REFERENCE } from "../diff-tab-target.js";
import { useMergeBase } from "../merge-base.js";
import { useGitStatus } from "../queries.js";
import {
  DEFAULT_DIFF_FILE_FILTERS,
  diffExtensionCounts,
  filterDiffFiles,
  type DiffFileFilters,
} from "./diff-file-filters.js";
import { useDiffFiles, useDiffViewedRevisions } from "./diff-data.js";
import {
  summarizeDiffFileEntries,
  useDiffFilesCollapseControls,
} from "./diffFilesStore.js";
import {
  useGitDiffIgnoreWhitespacePreference,
  useGitDiffLineOverflowModePreference,
} from "./git-diff-view-preferences.js";
import { buildGitDiffIdentity } from "./gitDiffPanelHelpers.js";
import { GitDiffToolbar } from "./GitDiffToolbar.js";
import {
  GitDiffLoadingSkeleton,
  GitDiffEmptyNotice,
  GitDiffTabContent,
} from "./GitDiffTabContent.js";
import { DIFF_TOOLBAR_CHROME_CLASS } from "./panel-chrome.js";
import { useGitDiffPanelState } from "./useGitDiffPanelState.js";
import {
  useResponsiveGitDiffPanelDisplay,
} from "./useResponsiveGitDiffPanelDisplay.js";

const EMPTY_DIFF_FILES: readonly DiffFileEntry[] = [];

export function isDiffTabVisible({
  environmentState,
  threadArchived,
}: Pick<
  ExperimentalThreadFixedTabProps,
  "environmentState" | "threadArchived"
>): boolean {
  if (environmentState === null) return false;
  if (environmentState.state !== "loaded") return true;
  const executionUnavailable =
    !environmentState.hostActive || environmentState.status === "destroyed";
  if ((threadArchived || executionUnavailable) && !environmentState.managed) {
    return false;
  }
  return environmentState.isGitRepo;
}

export function DiffTab({
  environment,
  environmentState,
  isOpen,
}: ExperimentalThreadFixedTabProps) {
  const [gitDiffFilters, setGitDiffFilters] = useState(
    DEFAULT_DIFF_FILE_FILTERS,
  );
  if (environmentState === null) return null;
  if (environmentState.state === "loading") return <GitDiffLoadingSkeleton />;
  if (environmentState.state === "failed") {
    return (
      <EmptyStatePanel className="m-4 rounded-lg" role="status">
        <div className="flex flex-col items-center gap-3 text-center">
          <span>Could not determine whether this workspace uses Git.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={environmentState.retry}
          >
            Retry
          </Button>
        </div>
      </EmptyStatePanel>
    );
  }
  return (
    <EnvironmentDiffTab
      environmentId={environment?.id ?? null}
      record={environmentState}
      isOpen={isOpen}
      gitDiffFilters={gitDiffFilters}
      onGitDiffFiltersChange={setGitDiffFilters}
    />
  );
}

function EnvironmentDiffTab({
  environmentId,
  record,
  isOpen,
  gitDiffFilters,
  onGitDiffFiltersChange: setGitDiffFilters,
}: {
  environmentId: string | null;
  record: Extract<ExperimentalThreadEnvironmentState, { state: "loaded" }>;
  isOpen: boolean;
  gitDiffFilters: DiffFileFilters;
  onGitDiffFiltersChange: (filters: DiffFileFilters) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null!);
  const { width } = useResizeObserver({ ref: rootRef, box: "border-box" });
  const { gitDiffDisplayMode, handleGitDiffDisplayModeChange } =
    useResponsiveGitDiffPanelDisplay(width);
  const navigate = useBbNavigate();
  const status = useGitStatus(environmentId);
  const mergeBase = useMergeBase(environmentId, status.workspace, record, {
    loadOptions: isOpen,
  });
  const requestedMergeBaseBranch = mergeBase.effectiveMergeBaseBranch;
  const tabTarget = useFixedTabTarget(GIT_DIFF_TAB_REFERENCE);
  const clearTabTarget = tabTarget?.clear;
  const clearPendingIntent = useCallback(() => {
    clearTabTarget?.();
  }, [clearTabTarget]);
  const pendingScrollPath =
    tabTarget?.target.kind === "file" ? tabTarget.target.path : null;
  const pendingCommitSha =
    tabTarget?.target.kind === "commit" ? tabTarget.target.sha : null;

  const canOpenFileExternally = useCanOpenFileExternally(
    environmentId === null
      ? null
      : { kind: "workspace", environmentId, path: "" },
  );
  const openFileInEditor = useCallback(
    (path: string) => {
      if (environmentId === null) return;
      navigate.experimental_openFileExternally({
        target: { kind: "workspace", environmentId, path },
        location: null,
      });
    },
    [environmentId, navigate],
  );
  const openFilePreview = useCallback(
    (path: string) => {
      if (environmentId === null) return;
      navigate.experimental_openFilePreview({
        target: { kind: "workspace", environmentId, path },
        location: null,
      });
    },
    [environmentId, navigate],
  );

  const {
    gitDiffFileFilter,
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
    setGitDiffFileFilter,
  } = useGitDiffPanelState({
    environmentId,
    requestedMergeBaseBranch,
    workspaceStatus: status.workspace,
    pendingScrollPath,
    pendingCommitSha,
    pendingSequence: tabTarget?.sequence ?? null,
    onClearPendingIntent: clearPendingIntent,
  });
  const [gitDiffIgnoreWhitespace, setGitDiffIgnoreWhitespace] =
    useGitDiffIgnoreWhitespacePreference();
  const filesQuery = useDiffFiles({
    environmentId: environmentId ?? "",
    target: gitDiffTarget,
    ignoreWhitespace: gitDiffIgnoreWhitespace,
    enabled: isOpen && environmentId !== null,
  });
  const diffFilesResponse = filesQuery.shown?.result;
  const shownTarget = filesQuery.shown?.target ?? gitDiffTarget;
  const shownIgnoreWhitespace =
    filesQuery.shown?.ignoreWhitespace ?? gitDiffIgnoreWhitespace;
  const isDiffFilesLoading = filesQuery.isLoading;
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
        environmentId: environmentId ?? "",
        mergeBaseRef: diffMergeBaseRef,
        target: shownTarget,
      }),
    [diffMergeBaseRef, environmentId, shownTarget],
  );
  const diffPaths = useMemo(
    () => diffFiles.map((file) => file.path),
    [diffFiles],
  );
  const { viewedRevisionByPath } = useDiffViewedRevisions({
    environmentId: environmentId ?? "",
    target: shownTarget,
    paths: diffPaths,
    enabled: isOpen && environmentId !== null,
  });
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

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className={DIFF_TOOLBAR_CHROME_CLASS}>
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
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {environmentId === null ? (
          <GitDiffEmptyNotice />
        ) : (
          <GitDiffTabContent
            environmentId={environmentId}
            target={shownTarget}
            diffIdentity={diffIdentity}
            files={{
              result: diffFilesResponse,
              error: filesQuery.error,
              isLoading: isDiffFilesLoading,
              isPlaceholder: filesQuery.isPlaceholder,
            }}
            gitDiffPresentation={gitDiffPresentation}
            ignoreWhitespace={shownIgnoreWhitespace}
            isLive={isOpen}
            fileFilter={gitDiffFileFilter ?? ""}
            filters={gitDiffFilters}
            onClearPendingGitDiffIntent={clearPendingIntent}
            onOpenFileInEditor={
              canOpenFileExternally && record.path !== null
                ? openFileInEditor
                : undefined
            }
            onOpenFilePreview={openFilePreview}
            pendingGitDiffScrollPath={pendingScrollPath}
            workspaceRootPath={record.path}
          />
        )}
      </div>
    </div>
  );
}
