import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useCallback, useState } from "react";
import { useGitDiffDisplayModePreference } from "@/lib/git-diff-view-preferences";
import type {
  GitDiffDisplayMode,
  GitDiffDisplayModeChangeHandler,
} from "../GitDiffToolbar";
import type { SecondaryPanelWidthChangeHandler } from "../useSecondaryPanelResize";

const GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX = 760;

export const COMPACT_GIT_DIFF_DISPLAY_MODE: GitDiffDisplayMode = "unified";

interface ResolveGitDiffDisplayModeArgs {
  isCompactViewport: boolean;
  compactDisplayMode: GitDiffDisplayMode | null;
  displayModePreference: GitDiffDisplayMode | null;
  isWideEnoughForSplit: boolean | null;
}

export function resolveGitDiffDisplayMode({
  isCompactViewport,
  compactDisplayMode,
  displayModePreference,
  isWideEnoughForSplit,
}: ResolveGitDiffDisplayModeArgs): GitDiffDisplayMode {
  if (isCompactViewport) {
    return compactDisplayMode ?? COMPACT_GIT_DIFF_DISPLAY_MODE;
  }
  if (displayModePreference !== null) {
    return displayModePreference;
  }
  return isWideEnoughForSplit === true ? "split" : "unified";
}

export function resolveIsWideEnoughForSplit({
  isSecondaryPanelOpen,
  nextWidth,
}: {
  isSecondaryPanelOpen: boolean;
  nextWidth: number | undefined;
}): boolean | null {
  if (!isSecondaryPanelOpen || nextWidth === undefined) {
    return null;
  }
  return nextWidth >= GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX;
}

export type GitDiffDisplayModeChangeTarget =
  | "compact-session"
  | "stored-preference";

export function resolveGitDiffDisplayModeChangeTarget(
  isCompactViewport: boolean,
): GitDiffDisplayModeChangeTarget {
  return isCompactViewport ? "compact-session" : "stored-preference";
}

interface UseResponsiveGitDiffPanelDisplayArgs {
  isSecondaryPanelOpen: boolean;
}

export function useResponsiveGitDiffPanelDisplay({
  isSecondaryPanelOpen,
}: UseResponsiveGitDiffPanelDisplayArgs) {
  const isCompactViewport = useIsCompactViewport();
  const [displayModePreference, setDisplayModePreference] =
    useGitDiffDisplayModePreference();
  const [compactDisplayMode, setCompactDisplayMode] =
    useState<GitDiffDisplayMode | null>(null);
  const [isWideEnoughForSplit, setIsWideEnoughForSplit] = useState<
    boolean | null
  >(null);

  const handleSecondaryPanelWidthChange =
    useCallback<SecondaryPanelWidthChangeHandler>(
      (nextWidth) => {
        const nextWideEnough = resolveIsWideEnoughForSplit({
          isSecondaryPanelOpen,
          nextWidth,
        });
        if (nextWideEnough === null) {
          return;
        }
        setIsWideEnoughForSplit((current) =>
          current === nextWideEnough ? current : nextWideEnough,
        );
      },
      [isSecondaryPanelOpen],
    );

  const handleGitDiffDisplayModeChange =
    useCallback<GitDiffDisplayModeChangeHandler>(
      (nextMode) => {
        if (
          resolveGitDiffDisplayModeChangeTarget(isCompactViewport) ===
          "compact-session"
        ) {
          setCompactDisplayMode(nextMode);
          return;
        }
        setDisplayModePreference(nextMode);
      },
      [isCompactViewport, setDisplayModePreference],
    );

  return {
    gitDiffDisplayMode: resolveGitDiffDisplayMode({
      isCompactViewport,
      compactDisplayMode,
      displayModePreference,
      isWideEnoughForSplit,
    }),
    handleGitDiffDisplayModeChange,
    handleSecondaryPanelWidthChange,
  };
}
