import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import type { FileDiffOptions, SelectedLineRange } from "@pierre/diffs";
import { FileDiff as DiffView } from "@pierre/diffs/react";
import { usePierreLineSelectionActions } from "@/components/git-diff/PierreLineSelectionActions.js";
import { PierreWorkerPoolBoundary } from "@/lib/pierre-worker-pool-boundary";
import { useRequirePierreWorkerPool } from "@/lib/pierre-worker-pool-gate";
import { usePierreStrictModeRecoveryOptions } from "@/lib/pierre-strict-mode-recovery";
import {
  buildDiffDomSelectionText,
  buildDiffLineSelectionText,
} from "@/components/git-diff/git-diff-patch-text";
import { useResolvedCodeThemePair } from "@/lib/code-theme";
import { usePreferredTheme } from "@/hooks/useTheme";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import type { BbDiffProps } from "./code-rendering";

const DIFF_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
} as CSSProperties;

function BbDiffSkeleton() {
  return (
    <div className="space-y-1.5 px-3 py-3">
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-[96%] rounded-sm" />
      <Skeleton className="h-3 w-[93%] rounded-sm" />
      <Skeleton className="h-3 w-[90%] rounded-sm" />
      <Skeleton className="h-3 w-[87%] rounded-sm" />
      <Skeleton className="h-3 w-[84%] rounded-sm" />
    </div>
  );
}

/**
 * BB's default diff renderer: the `@pierre/diffs` `FileDiff` plus BB's line
 * selection menu, resolved code theme, and presentation defaults. Reached only
 * through {@link import("./DiffHost").DiffHost}, and only lazily — a plugin
 * that replaces the renderer and never delegates never loads this module.
 */
export function BbDiff({
  file,
  view,
  overflow,
  showLineNumbers,
  className,
  expansionLineCount,
  onSelectionAddToChat,
}: BbDiffProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const codeTheme = useResolvedCodeThemePair();
  const themeType = usePreferredTheme();
  const buildSelectionText = useCallback(
    (range: SelectedLineRange) =>
      buildDiffLineSelectionText({
        displayStyle: view,
        fileDiff: file,
        range,
      }),
    [file, view],
  );
  const buildFallbackSelectionText = useCallback(
    ({
      containerElement,
    }: {
      containerElement: HTMLElement | null;
      range: SelectedLineRange;
    }) => buildDiffDomSelectionText({ containerElement, fileDiff: file }),
    [file],
  );
  const lineSelectionActions = usePierreLineSelectionActions({
    buildFallbackSelectionText,
    buildSelectionText,
    containerRef,
    enabled: onSelectionAddToChat !== undefined,
    onSelectionAddToChat,
  });
  const baseOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      diffStyle: view,
      overflow,
      disableLineNumbers: !showLineNumbers,
      // The card's own header owns the file name, path actions, and stats.
      disableFileHeader: true,
      // Only set when the caller can actually supply full file contents:
      // pierre renders an empty diff when it is handed an expansion budget
      // for a hunk-only patch, which is what the timeline supplies.
      ...(expansionLineCount === undefined ? {} : { expansionLineCount }),
      themeType,
      theme: codeTheme,
      enableGutterUtility: onSelectionAddToChat !== undefined,
      enableLineSelection: onSelectionAddToChat !== undefined,
      lineHoverHighlight:
        onSelectionAddToChat === undefined ? "disabled" : "number",
      onGutterUtilityClick:
        onSelectionAddToChat === undefined
          ? undefined
          : lineSelectionActions.onGutterUtilityClick,
      onLineSelectionChange: lineSelectionActions.onLineSelectionChange,
      onLineSelectionEnd: lineSelectionActions.onLineSelectionEnd,
      onLineSelectionStart: lineSelectionActions.onLineSelectionStart,
    }),
    [
      codeTheme,
      expansionLineCount,
      lineSelectionActions.onGutterUtilityClick,
      lineSelectionActions.onLineSelectionChange,
      lineSelectionActions.onLineSelectionEnd,
      lineSelectionActions.onLineSelectionStart,
      onSelectionAddToChat,
      overflow,
      showLineNumbers,
      themeType,
      view,
    ],
  );
  const options = usePierreStrictModeRecoveryOptions(baseOptions);
  // `DiffView` captures the worker pool when it creates its instance, so wait
  // for the workspace to build the pool before the first render. Asking here
  // rather than in the host keeps the pool unbuilt when a plugin replacement
  // owns the render and never delegates.
  const isWorkerPoolReady = useRequirePierreWorkerPool();
  if (!isWorkerPoolReady) {
    return <BbDiffSkeleton />;
  }
  return (
    <div
      ref={containerRef}
      className={cn("overflow-x-auto", className)}
      onPointerDownCapture={lineSelectionActions.onPointerDownCapture}
      onPointerMoveCapture={lineSelectionActions.onPointerMoveCapture}
      onPointerUpCapture={lineSelectionActions.onPointerUpCapture}
    >
      <div className="w-full max-w-full" style={DIFF_VIEW_STYLE}>
        <PierreWorkerPoolBoundary>
          <DiffView
            fileDiff={file}
            options={options}
            selectedLines={lineSelectionActions.selectedRange}
          />
        </PierreWorkerPoolBoundary>
      </div>
      {lineSelectionActions.menu}
    </div>
  );
}

export default BbDiff;
