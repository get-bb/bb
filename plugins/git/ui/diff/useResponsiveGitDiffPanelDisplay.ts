import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useCallback, useState } from "react";
import {
  useGitDiffDisplayModePreference,
  type GitDiffDisplayMode,
  type GitDiffDisplayModeChangeHandler,
} from "./git-diff-view-preferences.js";

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

export function resolveIsWideEnoughForSplit(
  widthPx: number | undefined,
): boolean | null {
  if (widthPx === undefined || widthPx <= 0) {
    return null;
  }
  return widthPx >= GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX;
}

export type GitDiffDisplayModeChangeTarget =
  | "compact-session"
  | "stored-preference";

export function resolveGitDiffDisplayModeChangeTarget(
  isCompactViewport: boolean,
): GitDiffDisplayModeChangeTarget {
  return isCompactViewport ? "compact-session" : "stored-preference";
}

export function useResponsiveGitDiffPanelDisplay(widthPx: number | undefined) {
  const isCompactViewport = useIsCompactViewport();
  const [displayModePreference, setDisplayModePreference] =
    useGitDiffDisplayModePreference();
  const [compactDisplayMode, setCompactDisplayMode] =
    useState<GitDiffDisplayMode | null>(null);
  const [isWideEnoughForSplit, setIsWideEnoughForSplit] = useState<
    boolean | null
  >(null);
  const nextWideEnough = resolveIsWideEnoughForSplit(widthPx);
  if (nextWideEnough !== null && nextWideEnough !== isWideEnoughForSplit) {
    setIsWideEnoughForSplit(nextWideEnough);
  }

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
  };
}
