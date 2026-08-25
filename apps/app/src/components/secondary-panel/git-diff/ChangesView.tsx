import { useMemo, useState } from "react";
import type { ExperimentalChangesViewTargetState } from "@get-bb/plugin-sdk";
import type { DiffFileEntry } from "@bb/server-contract";
import {
  DEFAULT_CODE_OVERFLOW_MODE,
  type CodeOverflowMode,
} from "@/lib/code-overflow-mode";
import type { DiffPresentation } from "@/components/code/code-rendering";
import { useEnvironmentDiffFiles } from "@/hooks/queries/environment-queries";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "../panelChromeClasses";
import {
  GitDiffToolbar,
  type GitDiffDisplayMode,
  type GitDiffDisplayModeChangeHandler,
} from "../GitDiffToolbar";
import { GitDiffTabContent } from "../ThreadSecondaryPanelTabContent";
import {
  summarizeDiffFileEntries,
  useDiffFilesCollapseControls,
} from "./diffFilesStore";
import { buildGitDiffIdentity } from "./gitDiffPanelHelpers";
import { useGitDiffPanelState } from "./useGitDiffPanelState";

const EMPTY_DIFF_FILES: readonly DiffFileEntry[] = [];

/**
 * The wrap/scroll choice for diff lines. The view unmounts with its tab, so
 * the choice is kept here: it is how the user reads diffs, not a property of
 * one visit to the tab.
 */
let rememberedLineOverflowMode: CodeOverflowMode = DEFAULT_CODE_OVERFLOW_MODE;

export interface ChangesViewProps {
  displayMode: GitDiffDisplayMode;
  environmentId?: string;
  experimental_target: ExperimentalChangesViewTargetState | null;
  isPanelOpen: boolean;
  onDisplayModeChange: GitDiffDisplayModeChangeHandler;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
  requestedMergeBaseBranch?: string;
  workspaceRootPath?: string | null;
}

/** BB's complete native Changes toolbar and virtualized file body. */
export function ChangesView({
  displayMode,
  environmentId,
  experimental_target,
  isPanelOpen,
  onDisplayModeChange,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  requestedMergeBaseBranch,
  workspaceRootPath,
}: ChangesViewProps) {
  const {
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
  } = useGitDiffPanelState({
    environmentId,
    isDiffPanelActive: isPanelOpen,
    requestedMergeBaseBranch,
    experimental_target,
  });
  const { data: diffFilesResponse, isLoading: isDiffFilesLoading } =
    useEnvironmentDiffFiles(environmentId ?? "", {
      enabled:
        isPanelOpen && Boolean(environmentId) && gitDiffTarget !== undefined,
      target: gitDiffTarget,
    });
  const diffFiles = useMemo(
    () =>
      diffFilesResponse?.outcome === "available"
        ? diffFilesResponse.files
        : EMPTY_DIFF_FILES,
    [diffFilesResponse],
  );
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
  const gitDiffStats = useMemo(
    () => summarizeDiffFileEntries(diffFiles),
    [diffFiles],
  );
  const { areAllCollapsed, toggleAllCollapsed, hasFiles } =
    useDiffFilesCollapseControls(diffIdentity, diffFiles);
  const [lineOverflowMode, setLineOverflowModeState] = useState<CodeOverflowMode>(
    rememberedLineOverflowMode,
  );
  const setLineOverflowMode = (mode: CodeOverflowMode): void => {
    rememberedLineOverflowMode = mode;
    setLineOverflowModeState(mode);
  };
  const presentation = useMemo<DiffPresentation>(
    () => ({
      view: displayMode,
      overflow: lineOverflowMode,
      showLineNumbers: true,
    }),
    [displayMode, lineOverflowMode],
  );

  return (
    <>
      <div
        className={`shrink-0 select-none ${SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS}`}
      >
        <GitDiffToolbar
          selectionValue={gitDiffSelectValue}
          selectionOptions={gitDiffSelectOptions}
          onSelectionChange={onGitDiffSelectionChange}
          isSelectorDisabled={isDiffFilesLoading || gitDiffTarget === undefined}
          stats={gitDiffStats}
          isTruncated={isGitDiffTruncated}
          areAllFilesCollapsed={areAllCollapsed}
          isCollapseAllDisabled={!hasFiles || isDiffFilesLoading}
          onToggleAllCollapsed={toggleAllCollapsed}
          displayMode={displayMode}
          onDisplayModeChange={onDisplayModeChange}
          lineOverflowMode={lineOverflowMode}
          onLineOverflowModeChange={setLineOverflowMode}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
        <GitDiffTabContent
          environmentId={environmentId}
          target={gitDiffTarget}
          isDiffPanelActive
          isPanelOpen={isPanelOpen}
          gitDiffPresentation={presentation}
          onClearPendingGitDiffIntent={experimental_target?.clear}
          onOpenFileInEditor={onOpenFileInEditor}
          onOpenFilePreview={onOpenFilePreview}
          onSelectionAddToChat={onSelectionAddToChat}
          pendingGitDiffScrollPath={
            experimental_target?.target.kind === "file"
              ? experimental_target.target.path
              : null
          }
          workspaceRootPath={workspaceRootPath}
        />
      </div>
    </>
  );
}
