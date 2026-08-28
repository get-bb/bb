import {
  useCallback,
  useMemo,
  useRef,
  type ComponentProps,
  type ComponentType,
  type CSSProperties,
} from "react";
import {
  processFile,
  type FileDiffOptions,
  type SelectedLineRange,
  type PostRenderPhase,
} from "@pierre/diffs";
import { FileDiff as DiffView } from "@pierre/diffs/react";
import { usePierreLineSelectionActions } from "@/components/git-diff/PierreLineSelectionActions.js";
import { PierreWorkerPoolBoundary } from "@/lib/pierre-worker-pool-boundary";
import { useRequirePierreWorkerPool } from "@/lib/pierre-worker-pool-gate";
import { usePierreStrictModeRecoveryOptions } from "@/lib/pierre-strict-mode-recovery";
import {
  buildFileDiffPatchText,
  buildDiffDomSelectionText,
  buildDiffLineSelectionText,
} from "@/components/git-diff/git-diff-patch-text";
import { enrichGitDiffFileForContext } from "@/components/git-diff/git-diff-parsing";
import { useResolvedCodeThemePair } from "@/lib/code-theme";
import { usePreferredTheme } from "@/hooks/useTheme";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import type { BbDiffProps } from "./code-rendering";

export type BbDiffRenderer = ComponentType<{
  fileDiff: ComponentProps<typeof DiffView>["fileDiff"];
  options:
    | FileDiffOptions<undefined>
    | {
        onPostRender(
          node: HTMLElement,
          instance: { rerender(): void },
          phase: PostRenderPhase,
        ): void;
      }
    | undefined;
  selectedLines: ComponentProps<typeof DiffView>["selectedLines"];
}>;

export interface BbDiffDependencies {
  DiffView: BbDiffRenderer;
  processFile: typeof processFile;
}

const defaultBbDiffDependencies: BbDiffDependencies = {
  DiffView,
  processFile,
};

const DIFF_VIEW_STYLE: CSSProperties & Record<`--${string}`, string> = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
};

const DEFAULT_DIFF_EXPANSION_LINE_COUNT = 30;

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

export function BbDiff({
  file,
  patchText,
  fullFileContents,
  view,
  overflow,
  showLineNumbers,
  className,
  onSelectionAddToChat,
  dependencies = defaultBbDiffDependencies,
}: BbDiffProps & { dependencies?: BbDiffDependencies }) {
  const processFileFn = dependencies.processFile;
  const DiffRenderer = dependencies.DiffView;
  const oldPath = fullFileContents?.old.path;
  const oldContent = fullFileContents?.old.content;
  const newPath = fullFileContents?.new.path;
  const newContent = fullFileContents?.new.content;
  const resolvedFile = useMemo(() => {
    if (
      oldPath === undefined ||
      oldContent === undefined ||
      newPath === undefined ||
      newContent === undefined
    ) {
      return file;
    }
    return enrichGitDiffFileForContext(
      {
        fileDiff: file,
        oldFile: { name: oldPath, contents: oldContent },
        newFile: { name: newPath, contents: newContent },
        patchText: patchText ?? buildFileDiffPatchText(file),
      },
      processFileFn,
    );
  }, [
    file,
    newContent,
    newPath,
    oldContent,
    oldPath,
    patchText,
    processFileFn,
  ]);
  const expansionLineCount =
    resolvedFile !== file && resolvedFile.isPartial === false
      ? DEFAULT_DIFF_EXPANSION_LINE_COUNT
      : undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const codeTheme = useResolvedCodeThemePair();
  const themeType = usePreferredTheme();
  const buildSelectionText = useCallback(
    (range: SelectedLineRange) =>
      buildDiffLineSelectionText({
        displayStyle: view,
        fileDiff: resolvedFile,
        range,
      }),
    [resolvedFile, view],
  );
  const buildFallbackSelectionText = useCallback(
    ({
      containerElement,
    }: {
      containerElement: HTMLElement | null;
      range: SelectedLineRange;
    }) =>
      buildDiffDomSelectionText({ containerElement, fileDiff: resolvedFile }),
    [resolvedFile],
  );
  const lineSelectionActions = usePierreLineSelectionActions({
    buildFallbackSelectionText,
    buildSelectionText,
    containerRef,
    enabled: onSelectionAddToChat !== undefined,
    onSelectionAddToChat,
  });
  const baseOptions = useMemo<FileDiffOptions<undefined>>(() => {
    const options: FileDiffOptions<undefined> = {
      diffStyle: view,
      overflow,
      disableLineNumbers: !showLineNumbers,
      disableFileHeader: true,
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
    };
    if (expansionLineCount !== undefined) {
      options.expansionLineCount = expansionLineCount;
    }
    return options;
  }, [
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
  ]);
  const options = usePierreStrictModeRecoveryOptions(baseOptions);
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
          <DiffRenderer
            fileDiff={resolvedFile}
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
