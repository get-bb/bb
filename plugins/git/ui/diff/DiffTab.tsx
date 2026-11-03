import { useCallback, useMemo, useRef, useState } from "react";
import { useResizeObserver } from "usehooks-ts";
import {
  experimental_useFixedTabTarget as useFixedTabTarget,
  experimental_useTabVisible as useTabVisible,
  useBbNavigate,
  type ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import type { DiffPresentation } from "@bb/shared-ui/git-diff/renderers";
import type { DiffFileEntry } from "../../contract.js";
import { GIT_DIFF_TAB_REFERENCE } from "../diff-tab-target.js";
import { useMergeBase } from "../merge-base.js";
import { useGitStatus, useWorkspacePath } from "../queries.js";
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
  GitDiffTabContent,
} from "./GitDiffTabContent.js";
import { DIFF_TOOLBAR_CHROME_CLASS } from "./panel-chrome.js";
import { useGitDiffPanelState } from "./useGitDiffPanelState.js";
import {
  useResponsiveGitDiffPanelDisplay,
} from "./useResponsiveGitDiffPanelDisplay.js";

const EMPTY_DIFF_FILES: readonly DiffFileEntry[] = [];

export function useDiffTabVisible({
  environment,
}: ExperimentalThreadTabProps): boolean {
  const status = useGitStatus(environment?.id ?? null);
  return (
    environment !== null && status.result?.outcome !== "not_applicable"
  );
}

const diffFiltersByEnvironment = new Map<string, DiffFileFilters>();

export function DiffTab({ environment }: ExperimentalThreadTabProps) {
  if (environment === null) return null;
  return (
    <EnvironmentDiffTabGate
      key={environment.id}
      environmentId={environment.id}
    />
  );
}

function EnvironmentDiffTabGate({ environmentId }: { environmentId: string }) {
  const status = useGitStatus(environmentId);
  const [gitDiffFilters, setGitDiffFilters] = useState(
    () => diffFiltersByEnvironment.get(environmentId) ?? DEFAULT_DIFF_FILE_FILTERS,
  );
  const changeGitDiffFilters = useCallback(
    (filters: DiffFileFilters) => {
      diffFiltersByEnvironment.set(environmentId, filters);
      setGitDiffFilters(filters);
    },
    [environmentId],
  );
  if (status.workspace !== undefined) {
    return (
      <EnvironmentDiffTab
        environmentId={environmentId}
        gitDiffFilters={gitDiffFilters}
        onGitDiffFiltersChange={changeGitDiffFilters}
      />
    );
  }
  if (status.result?.outcome === "not_applicable") return null;
  const message =
    status.errorMessage ??
    (status.failure === undefined ? null : status.failure.message);
  if (message === null) return <GitDiffLoadingSkeleton />;
  return (
    <EmptyStatePanel className="m-4 rounded-lg" role="status">
      <div className="flex flex-col items-center gap-3 text-center">
        <span>{message}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={status.retry}
        >
          Retry
        </Button>
      </div>
    </EmptyStatePanel>
  );
}

function EnvironmentDiffTab({
  environmentId,
  gitDiffFilters,
  onGitDiffFiltersChange: setGitDiffFilters,
}: {
  environmentId: string;
  gitDiffFilters: DiffFileFilters;
  onGitDiffFiltersChange: (filters: DiffFileFilters) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null!);
  const { width } = useResizeObserver({ ref: rootRef, box: "border-box" });
  const { gitDiffDisplayMode, handleGitDiffDisplayModeChange } =
    useResponsiveGitDiffPanelDisplay(width);
  const navigate = useBbNavigate();
  const status = useGitStatus(environmentId);
  const isLive = useTabVisible();
  const workspacePath = useWorkspacePath(environmentId);
  const mergeBase = useMergeBase(environmentId, status.workspace, {
    loadOptions: isLive,
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

  const openFileInEditor = useCallback(
    (path: string) => {
      navigate.experimental_openFileExternally({
        target: { kind: "workspace", environmentId, path },
        location: null,
      });
    },
    [environmentId, navigate],
  );
  const openFilePreview = useCallback(
    (path: string) => {
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
    environmentId,
    target: gitDiffTarget,
    ignoreWhitespace: gitDiffIgnoreWhitespace,
    enabled: isLive,
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
        environmentId,
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
    environmentId,
    target: shownTarget,
    paths: diffPaths,
    enabled: isLive,
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
          isLive={isLive}
          fileFilter={gitDiffFileFilter ?? ""}
          filters={gitDiffFilters}
          onClearPendingGitDiffIntent={clearPendingIntent}
          onOpenFileInEditor={
            workspacePath === null ? undefined : openFileInEditor
          }
          onOpenFilePreview={openFilePreview}
          pendingGitDiffScrollPath={pendingScrollPath}
          workspaceRootPath={workspacePath}
        />
      </div>
    </div>
  );
}
