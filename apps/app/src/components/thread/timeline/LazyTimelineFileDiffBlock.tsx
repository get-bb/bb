import { Skeleton } from "@bb/shared-ui/skeleton";
import { defineSplit } from "@/lib/define-split";
import type { TimelineFileDiffBlockProps } from "./TimelineFileDiffBlock.js";

function TimelineFileDiffBlockLoading() {
  return (
    <div
      role="status"
      aria-label="Loading diff"
      className="mt-1 space-y-1.5 rounded-lg border border-border bg-background px-3 py-3"
    >
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-[93%] rounded-sm" />
      <Skeleton className="h-3 w-[87%] rounded-sm" />
    </div>
  );
}

export const LazyTimelineFileDiffBlock =
  defineSplit<TimelineFileDiffBlockProps>({
    id: "timeline-file-diff",
    load: () =>
      import("./TimelineFileDiffBlock.js").then(
        (module) => module.TimelineFileDiffBlock,
      ),
    loading: TimelineFileDiffBlockLoading,
    tier: "intent",
  });
