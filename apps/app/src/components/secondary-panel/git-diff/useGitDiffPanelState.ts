import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
} from "react";
import { useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { EnvironmentDiffFileResponse } from "@bb/server-contract";
import {
  useEnvironmentGitDiff,
  useEnvironmentWorkStatus,
} from "../../../hooks/queries/environment-queries";
import { environmentDiffFileQueryKey } from "../../../hooks/queries/query-keys";
import { getEnvironmentDiffFile, type DiffFileTarget } from "../../../lib/api";
import { normalizeFilePreviewMimeType } from "../../../lib/file-preview";
import type {
  DiffFileContentsResult,
  RequestDiffFileContents,
} from "../../git-diff/GitDiffCard";
import {
  gitDiffCollapsedFileKeysAtom,
  gitDiffLoadingFileKeysAtom,
  selectedMergeBaseBranchAtom,
} from "../threadSecondaryPanelAtoms";
import {
  buildParsedGitDiffFileEntries,
  doesGitDiffFileMatchPath,
  parseGitShortstat,
  parseGitDiffFiles,
  parseGitDiffPatchChunks,
  type ParsedGitDiffFile,
} from "../../git-diff/git-diff-parsing";
import { type GitDiffSelectionOption } from "../ThreadSecondaryPanel";
import {
  buildGitDiffParsePlan,
  buildGitDiffSelectionOptions,
  buildGitDiffTarget,
  GIT_DIFF_PARSE_BATCH_DELAY_MS,
  GIT_DIFF_PARSE_BATCH_SIZE,
  GIT_DIFF_PARSE_INITIAL_BATCH_SIZE,
  resolveGitDiffPreparationState,
  shouldResetSelectedGitDiffSelection,
  ALL_GIT_DIFF_SELECTION,
} from "./gitDiffPanelHelpers";
import { useGitDiffFileRenderQueue } from "./useGitDiffFileRenderQueue";
import {
  gitDiffPanelReducer,
  INITIAL_GIT_DIFF_PANEL_REDUCER_STATE,
  type GitDiffPanelIntent,
} from "./gitDiffPanelStateReducer";

function findNearestScrollableAncestor(
  element: HTMLElement,
): HTMLElement | null {
  for (
    let node = element.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
  }
  return null;
}

/**
 * Scroll a diff card to the top of its own scroll container.
 *
 * `Element.scrollIntoView()` adjusts *every* scrollable ancestor — including
 * the app shell's `overflow-hidden` wrappers, which are still scrollable
 * programmatically. That leaks the scroll up to the shell, nudging the page
 * and leaving the thread header offset until a full reload resets the shell's
 * `scrollTop`. We instead scroll only the nearest scrollable ancestor (the
 * diff list), which keeps the movement contained and preserves the sticky
 * headers. When no ancestor scrolls, the card is already fully visible, so
 * doing nothing is correct — falling back to `scrollIntoView` would reintroduce
 * the leak.
 */
function scrollDiffCardToContainerTop(target: HTMLElement): void {
  const container = findNearestScrollableAncestor(target);
  if (!container) {
    return;
  }
  container.scrollTop +=
    target.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

interface UseGitDiffPanelStateParams {
  environmentId?: string;
  intent?: GitDiffPanelIntent | null;
  isDiffPanelActive: boolean;
  threadId: string;
  defaultMergeBaseBranch?: string;
}

interface GitDiffIdentityParams {
  environmentId?: string;
  mergeBaseRef: string | null;
  target: WorkspaceDiffTarget | undefined;
}

interface GitDiffRequestIdentityParams {
  environmentId?: string;
  target: WorkspaceDiffTarget | undefined;
}

export function useGitDiffPanelState({
  environmentId,
  intent = null,
  isDiffPanelActive,
  threadId,
  defaultMergeBaseBranch,
}: UseGitDiffPanelStateParams) {
  const selectedMergeBaseBranch = useAtomValue(selectedMergeBaseBranchAtom);
  const collapsedGitDiffFileKeys = useAtomValue(gitDiffCollapsedFileKeysAtom);
  const loadingGitDiffFileKeys = useAtomValue(gitDiffLoadingFileKeysAtom);
  const [panelState, dispatch] = useReducer(
    gitDiffPanelReducer,
    INITIAL_GIT_DIFF_PANEL_REDUCER_STATE,
  );
  const {
    displayedGitDiffState,
    expectedGitDiffFileCount,
    isParsingGitDiffFiles,
    lastFocusedScrollPath,
    lastParsedGitDiffKey,
    parsedGitDiffFiles,
    pendingScrollPath,
    selectedGitDiffSelection,
  } = panelState;

  const effectiveMergeBaseBranch =
    selectedMergeBaseBranch ?? defaultMergeBaseBranch;
  const gitDiffTarget = useMemo(
    () =>
      buildGitDiffTarget(selectedGitDiffSelection, effectiveMergeBaseBranch),
    [effectiveMergeBaseBranch, selectedGitDiffSelection],
  );
  const gitDiffRequestIdentity = useMemo(
    () => buildGitDiffRequestIdentity({ environmentId, target: gitDiffTarget }),
    [environmentId, gitDiffTarget],
  );
  const { data: gitDiffWorkspaceStatus } = useEnvironmentWorkStatus(
    environmentId ?? "",
    effectiveMergeBaseBranch,
    {
      enabled:
        Boolean(environmentId) &&
        Boolean(effectiveMergeBaseBranch) &&
        isDiffPanelActive,
    },
  );
  const {
    data: fetchedGitDiffResponse,
    isLoading: isGitDiffLoading,
    isPlaceholderData: isGitDiffPlaceholderData,
    error: gitDiffError,
  } = useEnvironmentGitDiff(environmentId ?? "", {
    enabled:
      Boolean(environmentId) &&
      isDiffPanelActive &&
      gitDiffTarget !== undefined,
    target: gitDiffTarget,
  });
  const fetchedThreadGitDiff =
    fetchedGitDiffResponse?.outcome === "available"
      ? fetchedGitDiffResponse.diff
      : undefined;
  const localGitDiffUnavailableMessage =
    isDiffPanelActive && !environmentId
      ? "This thread does not have a workspace to diff."
      : isDiffPanelActive && gitDiffTarget === undefined
        ? "No merge base branch is configured for this workspace."
        : null;
  const gitDiffUnavailableMessage =
    localGitDiffUnavailableMessage ??
    (fetchedGitDiffResponse?.outcome === "unavailable"
      ? fetchedGitDiffResponse.failure.message
      : fetchedGitDiffResponse?.outcome === "not_applicable"
        ? fetchedGitDiffResponse.message
        : null);
  const workspaceStatus =
    gitDiffWorkspaceStatus?.outcome === "available"
      ? gitDiffWorkspaceStatus.workspace
      : undefined;
  useEffect(() => {
    if (fetchedThreadGitDiff && !isGitDiffPlaceholderData) {
      dispatch({
        type: "displayedResponseUpdated",
        requestIdentity: gitDiffRequestIdentity,
        response: fetchedThreadGitDiff,
      });
      return;
    }

    if (!isGitDiffLoading) {
      dispatch({
        type: "displayedResponseUnavailable",
        requestIdentity: gitDiffRequestIdentity,
      });
    }
  }, [
    fetchedThreadGitDiff,
    gitDiffRequestIdentity,
    isGitDiffLoading,
    isGitDiffPlaceholderData,
  ]);
  const threadGitDiff =
    fetchedThreadGitDiff && !isGitDiffPlaceholderData
      ? fetchedThreadGitDiff
      : displayedGitDiffState?.requestIdentity === gitDiffRequestIdentity
        ? displayedGitDiffState.response
        : undefined;
  const diffMergeBaseRef = threadGitDiff?.mergeBaseRef ?? null;
  const gitDiffIdentity = useMemo(
    () =>
      buildGitDiffIdentity({
        environmentId,
        mergeBaseRef: diffMergeBaseRef,
        target: gitDiffTarget,
      }),
    [diffMergeBaseRef, environmentId, gitDiffTarget],
  );
  const currentGitDiff = threadGitDiff?.diff ?? "";
  const parsedGitDiffFileEntries = useMemo(
    () => buildParsedGitDiffFileEntries(parsedGitDiffFiles),
    [parsedGitDiffFiles],
  );
  const {
    focusGitDiffFile,
    gitDiffFileRefs,
    queuedGitDiffFileRenderKeys,
    setGitDiffFileRef,
    toggleAllGitDiffFilesCollapsed,
    toggleGitDiffFileCollapsed,
  } = useGitDiffFileRenderQueue({
    environmentId,
    gitDiffIdentity,
    expectedGitDiffFileCount,
    parsedGitDiffFileEntries,
    isDiffPanelActive,
    isParsingGitDiffFiles,
  });
  const isAwaitingPrerequisites =
    isDiffPanelActive &&
    Boolean(environmentId) &&
    gitDiffTarget === undefined &&
    localGitDiffUnavailableMessage === null;
  const gitDiffPreparationState = resolveGitDiffPreparationState({
    currentGitDiff,
    isAwaitingPrerequisites,
    isGitDiffLoading,
    isParsingGitDiffFiles,
    lastParsedGitDiffKey,
    parsedGitDiffFileCount: parsedGitDiffFileEntries.length,
  });

  // --- Parsing pipeline ---

  useEffect(() => {
    const parsePlan = buildGitDiffParsePlan({
      gitDiff: currentGitDiff,
      isDiffPanelActive,
    });

    if (parsePlan.kind === "reset") {
      dispatch({ type: "parseReset" });
      return;
    }

    if (parsePlan.kind === "empty") {
      dispatch({ type: "parseEmpty", gitDiffKey: parsePlan.gitDiffKey });
      return;
    }

    if (parsePlan.kind === "immediate") {
      const parsedFiles = parseGitDiffFiles(currentGitDiff);
      dispatch({
        type: "parseImmediate",
        expectedFileCount: parsePlan.patchChunks.length,
        gitDiffKey: parsePlan.gitDiffKey,
        parsedFiles,
      });
      return;
    }

    const patchChunks = parsePlan.patchChunks;
    // Keep the previous rendered file list mounted during same-target
    // refetches. Replacing it with an empty or partial parse collapses the
    // scrollable content and remounts cards, which loses client-side state.
    const shouldBufferNextFiles =
      parsedGitDiffFiles.length > 0 &&
      lastParsedGitDiffKey !== parsePlan.gitDiffKey;
    let nextParsedFiles: ParsedGitDiffFile[] = [];
    let cancelled = false;
    let timerId: number | null = null;
    let nextPatchIndex = 0;
    let appliedFirstBatch = false;

    const parseNextBatch = () => {
      if (cancelled) return;

      const batchSize =
        nextPatchIndex === 0
          ? GIT_DIFF_PARSE_INITIAL_BATCH_SIZE
          : GIT_DIFF_PARSE_BATCH_SIZE;
      const batchChunks = patchChunks.slice(
        nextPatchIndex,
        nextPatchIndex + batchSize,
      );
      if (batchChunks.length === 0) {
        dispatch({
          type: "parseBatchedFinished",
          gitDiffKey: parsePlan.gitDiffKey,
        });
        return;
      }

      const parsedBatchFiles = parseGitDiffPatchChunks(batchChunks);
      if (cancelled) return;

      nextPatchIndex += batchChunks.length;
      if (shouldBufferNextFiles) {
        nextParsedFiles = [...nextParsedFiles, ...parsedBatchFiles];
      } else {
        dispatch({
          type: "parseBatchApplied",
          parsedFiles: parsedBatchFiles,
          replace: !appliedFirstBatch,
        });
      }
      appliedFirstBatch = true;

      if (nextPatchIndex >= patchChunks.length || cancelled) {
        if (shouldBufferNextFiles) {
          dispatch({
            type: "parseBatchedFinished",
            expectedFileCount: parsePlan.patchChunks.length,
            gitDiffKey: parsePlan.gitDiffKey,
            parsedFiles: nextParsedFiles,
          });
          return;
        }
        dispatch({
          type: "parseBatchedFinished",
          gitDiffKey: parsePlan.gitDiffKey,
        });
        return;
      }

      timerId = window.setTimeout(
        parseNextBatch,
        GIT_DIFF_PARSE_BATCH_DELAY_MS,
      );
    };

    dispatch({
      type: "parseBatchedStarted",
      clearFiles: !shouldBufferNextFiles,
      expectedFileCount: parsePlan.patchChunks.length,
    });
    parseNextBatch();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
    // Parse state is sampled when the diff input changes. Adding parsed-file
    // state here would restart and cancel the batched parse after dispatches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGitDiff, isDiffPanelActive]);

  // --- Reset on environment change ---

  useEffect(() => {
    dispatch({ type: "environmentChanged" });
  }, [environmentId]);

  useEffect(() => {
    dispatch({
      type: "intentReceived",
      intent:
        intent?.threadId === threadId &&
        intent.environmentId === (environmentId ?? null)
          ? intent
          : null,
    });
  }, [environmentId, intent, threadId]);

  const hasUncommittedChanges =
    (workspaceStatus?.workingTree.files.length ?? 0) > 0;

  useEffect(() => {
    if (
      shouldResetSelectedGitDiffSelection(
        selectedGitDiffSelection,
        workspaceStatus?.mergeBase?.commits ?? [],
        { hasUncommittedChanges },
      )
    ) {
      dispatch({ type: "staleSelectionReset" });
    }
  }, [
    hasUncommittedChanges,
    selectedGitDiffSelection,
    workspaceStatus?.mergeBase?.commits,
  ]);

  // --- Scroll-to-file effect ---

  // Layout effect so we measure + scroll *after* React commits the focus
  // collapse. Scrolling in the same tick as `focusGitDiffFile` would land
  // against the pre-collapse DOM, where sibling cards above the target are
  // still fully expanded — the smooth-scroll would then aim hundreds of pixels
  // too low, and the user would watch the target glide past the viewport as
  // the layout settled. We instead wait for collapsedGitDiffFileKeys and the
  // render queue to reflect the focus, then snap instantly to the target.
  useLayoutEffect(() => {
    if (!pendingScrollPath || !isDiffPanelActive) {
      dispatch({ type: "scrollFocusReset" });
      return;
    }

    const targetEntry = parsedGitDiffFileEntries.find(({ fileDiff }) =>
      doesGitDiffFileMatchPath(fileDiff, pendingScrollPath),
    );
    if (!targetEntry) {
      if (
        !isGitDiffLoading &&
        !isParsingGitDiffFiles &&
        !gitDiffPreparationState.isAwaitingCurrentGitDiffParse
      ) {
        dispatch({ type: "scrollRequestCleared" });
      }
      return;
    }

    if (lastFocusedScrollPath !== pendingScrollPath) {
      dispatch({ type: "scrollFocusStarted", path: pendingScrollPath });
      focusGitDiffFile(targetEntry.key);
      // Defer the scroll to the next effect run so we measure *after* the
      // focus collapse commits. If the target was already expanded and not
      // loading, the settled check below would otherwise pass against the
      // pre-collapse DOM — scrollIntoView would land hundreds of px too low,
      // and the target would end up in the middle of the panel once the
      // siblings shrank.
      return;
    }

    const isTargetCollapsed = collapsedGitDiffFileKeys.has(targetEntry.key);
    const isTargetRendering =
      !queuedGitDiffFileRenderKeys.has(targetEntry.key) ||
      loadingGitDiffFileKeys.has(targetEntry.key);
    if (isTargetCollapsed || isTargetRendering) {
      return;
    }

    const scrollTarget = gitDiffFileRefs.current.get(targetEntry.key);
    if (scrollTarget) {
      scrollDiffCardToContainerTop(scrollTarget);
    }
    dispatch({ type: "scrollRequestCleared" });
  }, [
    collapsedGitDiffFileKeys,
    focusGitDiffFile,
    gitDiffFileRefs,
    gitDiffPreparationState.isAwaitingCurrentGitDiffParse,
    isDiffPanelActive,
    isGitDiffLoading,
    isParsingGitDiffFiles,
    lastFocusedScrollPath,
    loadingGitDiffFileKeys,
    parsedGitDiffFileEntries,
    pendingScrollPath,
    queuedGitDiffFileRenderKeys,
  ]);

  // --- Derived values ---

  const diffCommits = useMemo(
    () => workspaceStatus?.mergeBase?.commits ?? [],
    [workspaceStatus?.mergeBase?.commits],
  );
  const gitDiffSelectValue = selectedGitDiffSelection ?? ALL_GIT_DIFF_SELECTION;
  const gitDiffSelectOptions: GitDiffSelectionOption[] = useMemo(
    () => buildGitDiffSelectionOptions(diffCommits, { hasUncommittedChanges }),
    [diffCommits, hasUncommittedChanges],
  );
  const gitDiffStats = useMemo(
    () => parseGitShortstat(threadGitDiff?.shortstat ?? ""),
    [threadGitDiff?.shortstat],
  );
  const { hasParsedGitDiffFiles, isPreparingGitDiff } = gitDiffPreparationState;

  const onGitDiffSelectionChange = useCallback((value: string) => {
    dispatch({
      type: "selectionChanged",
      selection: value === ALL_GIT_DIFF_SELECTION ? null : value,
    });
  }, []);

  const queryClient = useQueryClient();
  const fileTarget = useMemo<DiffFileTarget | undefined>(
    () => buildDiffFileTarget(gitDiffTarget, diffMergeBaseRef),
    [gitDiffTarget, diffMergeBaseRef],
  );
  const onRequestFileContents = useMemo<
    RequestDiffFileContents | undefined
  >(() => {
    if (!environmentId || fileTarget === undefined) return undefined;
    const envId = environmentId;
    const target = fileTarget;
    const targetKey = fileTargetKey(target);
    return async (path, side) => {
      const result = await queryClient.fetchQuery({
        queryKey: environmentDiffFileQueryKey(
          envId,
          target.type,
          targetKey,
          path,
          side,
        ),
        queryFn: () => getEnvironmentDiffFile(envId, target, path, side),
        staleTime: 5_000,
      });
      return toDiffFileContentsResult(path, result);
    };
  }, [environmentId, fileTarget, queryClient]);

  return {
    currentGitDiff,
    gitDiffError,
    gitDiffUnavailableMessage,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    gitDiffStats,
    hasParsedGitDiffFiles,
    isGitDiffLoading,
    isParsingGitDiffFiles,
    isPreparingGitDiff,
    onGitDiffSelectionChange,
    onRequestFileContents,
    parsedGitDiffFileEntries,
    queuedGitDiffFileRenderKeys,
    setGitDiffFileRef,
    threadGitDiff,
    toggleAllGitDiffFilesCollapsed,
    toggleGitDiffFileCollapsed,
  };
}

function buildGitDiffIdentity({
  environmentId,
  mergeBaseRef,
  target,
}: GitDiffIdentityParams): string {
  const environmentKey = environmentId ?? "none";
  if (!target) return `${environmentKey}:none`;

  switch (target.type) {
    case "uncommitted":
      return `${environmentKey}:uncommitted`;
    case "branch_committed":
      return [
        environmentKey,
        "branch_committed",
        target.mergeBaseBranch,
        mergeBaseRef ?? "pending",
      ].join(":");
    case "all":
      return [
        environmentKey,
        "all",
        target.mergeBaseBranch,
        mergeBaseRef ?? "pending",
      ].join(":");
    case "commit":
      return `${environmentKey}:commit:${target.sha}`;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function buildGitDiffRequestIdentity({
  environmentId,
  target,
}: GitDiffRequestIdentityParams): string {
  const environmentKey = environmentId ?? "none";
  if (!target) return `${environmentKey}:none`;

  switch (target.type) {
    case "uncommitted":
      return `${environmentKey}:uncommitted`;
    case "branch_committed":
      return [environmentKey, "branch_committed", target.mergeBaseBranch].join(
        ":",
      );
    case "all":
      return [environmentKey, "all", target.mergeBaseBranch].join(":");
    case "commit":
      return `${environmentKey}:commit:${target.sha}`;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function fileTargetKey(target: DiffFileTarget): string | null {
  switch (target.type) {
    case "uncommitted":
      return null;
    case "branch_committed":
    case "all":
      return target.mergeBaseRef;
    case "commit":
      return target.sha;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/**
 * Lift a `WorkspaceDiffTarget` (branch-name-shaped) into a `DiffFileTarget`
 * (SHA-shaped) once the diff response has surfaced the resolved merge base.
 * Returns `undefined` when we don't yet have a SHA for the merge-base side —
 * either the diff hasn't loaded yet, or the branch has no merge base with
 * HEAD (in which case the diff itself was empty and there's nothing for
 * context expansion to reach).
 */
function buildDiffFileTarget(
  target: WorkspaceDiffTarget | undefined,
  mergeBaseRef: string | null,
): DiffFileTarget | undefined {
  if (!target) return undefined;
  switch (target.type) {
    case "uncommitted":
      return { type: "uncommitted" };
    case "branch_committed":
      return mergeBaseRef
        ? { type: "branch_committed", mergeBaseRef }
        : undefined;
    case "all":
      return mergeBaseRef ? { type: "all", mergeBaseRef } : undefined;
    case "commit":
      return { type: "commit", sha: target.sha };
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function toDiffFileContentsResult(
  path: string,
  response: EnvironmentDiffFileResponse,
): DiffFileContentsResult | null {
  if (response.contentEncoding === "utf8") {
    return { kind: "text", file: { name: path, contents: response.content } };
  }
  const mimeType = normalizeFilePreviewMimeType(response.mimeType ?? null);
  if (mimeType.startsWith("image/")) {
    return {
      kind: "image",
      dataUrl: `data:${mimeType};base64,${response.content}`,
      sizeBytes: response.sizeBytes,
    };
  }
  // Non-image binary: `@pierre/diffs` wants a UTF-8 string for context
  // expansion and the card has no preview for it.
  return null;
}
