import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GitDiffDisplayMode,
  GitDiffDisplayModeChangeHandler,
} from "../GitDiffToolbar";
import type { SecondaryPanelWidthChangeHandler } from "../useSecondaryPanelResize";

const GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX = 760;

type SecondaryPanelResizeStartHandler = () => void;

interface UseResponsiveGitDiffPanelDisplayArgs {
  isSecondaryPanelOpen: boolean;
}

export function useResponsiveGitDiffPanelDisplay({
  isSecondaryPanelOpen,
}: UseResponsiveGitDiffPanelDisplayArgs) {
  const [gitDiffDisplayMode, setGitDiffDisplayMode] =
    useState<GitDiffDisplayMode>("unified");
  const lastDiffViewWideEnoughRef = useRef<boolean | null>(null);
  const hasExplicitDisplayModeRef = useRef(false);

  const handleSecondaryPanelWidthChange =
    useCallback<SecondaryPanelWidthChangeHandler>(
      (nextWidth) => {
        if (!isSecondaryPanelOpen || nextWidth === undefined) {
          return;
        }

        const isWideEnough = nextWidth >= GIT_DIFF_SPLIT_VIEW_MIN_WIDTH_PX;
        const previousWideEnough = lastDiffViewWideEnoughRef.current;
        const crossedBreakpoint =
          previousWideEnough !== null && previousWideEnough !== isWideEnough;

        if (crossedBreakpoint && hasExplicitDisplayModeRef.current) {
          hasExplicitDisplayModeRef.current = false;
        }

        if (!hasExplicitDisplayModeRef.current || crossedBreakpoint) {
          const nextMode = isWideEnough ? "split" : "unified";
          setGitDiffDisplayMode((current) =>
            current === nextMode ? current : nextMode,
          );
        }

        lastDiffViewWideEnoughRef.current = isWideEnough;
      },
      [isSecondaryPanelOpen, setGitDiffDisplayMode],
    );

  useEffect(() => {
    if (!isSecondaryPanelOpen) {
      hasExplicitDisplayModeRef.current = false;
      lastDiffViewWideEnoughRef.current = null;
    }
  }, [isSecondaryPanelOpen]);

  const handleGitDiffDisplayModeChange =
    useCallback<GitDiffDisplayModeChangeHandler>(
      (nextMode) => {
        hasExplicitDisplayModeRef.current = true;
        setGitDiffDisplayMode(nextMode);
      },
      [setGitDiffDisplayMode],
    );

  const handleSecondaryPanelResizeStart =
    useCallback<SecondaryPanelResizeStartHandler>(() => {
      hasExplicitDisplayModeRef.current = false;
    }, []);

  return {
    gitDiffDisplayMode,
    handleGitDiffDisplayModeChange,
    handleSecondaryPanelResizeStart,
    handleSecondaryPanelWidthChange,
  };
}
