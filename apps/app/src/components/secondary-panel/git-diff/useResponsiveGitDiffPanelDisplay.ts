import { useCallback, useRef, useState } from "react";
import type {
  GitDiffDisplayMode,
  GitDiffDisplayModeChangeHandler,
} from "../GitDiffToolbar";
import type { SecondaryPanelWidthChangeHandler } from "../useSecondaryPanelResize";

const GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX = 760;

interface UseResponsiveGitDiffPanelDisplayArgs {
  isSecondaryPanelOpen: boolean;
}

export function useResponsiveGitDiffPanelDisplay({
  isSecondaryPanelOpen,
}: UseResponsiveGitDiffPanelDisplayArgs) {
  const [gitDiffDisplayMode, setGitDiffDisplayMode] =
    useState<GitDiffDisplayMode>("unified");
  const hasExplicitDisplayModeRef = useRef(false);

  const handleSecondaryPanelWidthChange =
    useCallback<SecondaryPanelWidthChangeHandler>(
      (nextWidth) => {
        if (
          !isSecondaryPanelOpen ||
          nextWidth === undefined ||
          hasExplicitDisplayModeRef.current
        ) {
          return;
        }

        const nextMode =
          nextWidth >= GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX ? "split" : "unified";
        setGitDiffDisplayMode((current) =>
          current === nextMode ? current : nextMode,
        );
      },
      [isSecondaryPanelOpen],
    );

  const handleGitDiffDisplayModeChange =
    useCallback<GitDiffDisplayModeChangeHandler>((nextMode) => {
      hasExplicitDisplayModeRef.current = true;
      setGitDiffDisplayMode(nextMode);
    }, []);

  return {
    gitDiffDisplayMode,
    handleGitDiffDisplayModeChange,
    handleSecondaryPanelWidthChange,
  };
}
