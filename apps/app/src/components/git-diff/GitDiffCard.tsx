import { memo, useMemo } from "react";
import { useIntersectionObserver } from "usehooks-ts";
import { cn } from "@bb/shared-ui/lib/utils";
import type { DiffPresentation } from "@/components/code/code-rendering";
import { GitDiffCardBody, useGitDiffCardBody } from "./GitDiffCardBody";
import {
  GitDiffCardHeader,
  gitDiffCardHeaderWrapperClass,
  type GitDiffCardHeaderModel,
} from "./GitDiffCardHeader";
import {
  formatGitDiffFileLabel,
  getGitDiffFileChangeKind,
  getOpenableGitDiffPath,
  normalizeGitDiffPath,
  summarizeGitDiffFile,
  type ParsedGitDiffFile,
} from "./git-diff-parsing";

interface GitDiffCardProps {
  fileDiff: ParsedGitDiffFile;
  presentation: DiffPresentation;
  patchText?: string;
  filePathRoot?: string | null;
  stickyHeader?: boolean;
  cardClassName?: string;
  showStuckHeaderEdge?: boolean;
}

function buildGitDiffCardHeaderModel(
  fileDiff: ParsedGitDiffFile,
): GitDiffCardHeaderModel {
  const stats = summarizeGitDiffFile(fileDiff);
  return {
    label: formatGitDiffFileLabel(fileDiff),
    path: normalizeGitDiffPath(fileDiff.name) ?? fileDiff.name,
    openablePath: getOpenableGitDiffPath(fileDiff),
    changeKind: getGitDiffFileChangeKind(fileDiff),
    insertions: stats.insertions,
    deletions: stats.deletions,
  };
}

export const GitDiffCard = memo(function GitDiffCard({
  fileDiff,
  presentation,
  patchText,
  filePathRoot,
  stickyHeader = false,
  cardClassName,
  showStuckHeaderEdge = true,
}: GitDiffCardProps) {
  const headerModel = useMemo(
    () => buildGitDiffCardHeaderModel(fileDiff),
    [fileDiff],
  );
  const previousPath = normalizeGitDiffPath(fileDiff.prevName) ?? null;
  const bodyState = useGitDiffCardBody({
    fileDiff,
    changeKind: headerModel.changeKind,
    onRequestFileContents: undefined,
    patchText,
  });
  const hasChanges = fileDiff.hunks.length > 0;
  const { ref: stickySentinelRef, isIntersecting } = useIntersectionObserver({
    initialIsIntersecting: true,
    threshold: 1,
  });
  const isHeaderStuck = stickyHeader && !isIntersecting;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background",
        cardClassName,
      )}
    >
      {stickyHeader ? <div ref={stickySentinelRef} className="h-0" /> : null}
      <div
        className={gitDiffCardHeaderWrapperClass({
          stickyHeader,
          isBodyHidden: !hasChanges,
          isStuck: isHeaderStuck,
          showStuckHeaderEdge,
        })}
      >
        <GitDiffCardHeader
          model={headerModel}
          previousPath={previousPath}
          filePathRoot={filePathRoot}
          hasChanges={hasChanges}
        />
      </div>
      {hasChanges ? (
        <GitDiffCardBody
          state={bodyState}
          presentation={presentation}
          svgDisplayMode="preview"
          reservesCollapseGutter={false}
        />
      ) : null}
    </div>
  );
});
