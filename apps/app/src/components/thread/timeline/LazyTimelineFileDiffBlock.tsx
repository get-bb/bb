import { lazy, Suspense } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { TimelineFileDiffBlockProps } from "./TimelineFileDiffBlock.js";

/**
 * `TimelineFileDiffBlock` parses patches with `@pierre/diffs` and renders
 * them with its FileDiff (Shiki behind it). Loading that chunk when the first
 * file-change row expands, instead of with the thread route, keeps the diff
 * engine out of the SplitWorkspaceRoute closure that every thread open pays
 * for. Rows that never show a diff never fetch it.
 */
const TimelineFileDiffBlockChunk = lazy(() =>
  import("./TimelineFileDiffBlock.js").then(({ TimelineFileDiffBlock }) => ({
    default: TimelineFileDiffBlock,
  })),
);

function TimelineFileDiffBlockSkeleton() {
  return (
    <div
      className="mt-1 space-y-1.5 rounded-lg border border-border bg-background px-3 py-3"
      data-testid="timeline-file-diff-skeleton"
    >
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-[93%] rounded-sm" />
      <Skeleton className="h-3 w-[87%] rounded-sm" />
    </div>
  );
}

export function LazyTimelineFileDiffBlock(props: TimelineFileDiffBlockProps) {
  return (
    <Suspense fallback={<TimelineFileDiffBlockSkeleton />}>
      <TimelineFileDiffBlockChunk {...props} />
    </Suspense>
  );
}
