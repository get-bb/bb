import { defineSplit } from "@/lib/define-split";
import type { TimelineFileDiffBlockProps } from "./TimelineFileDiffBlock.js";

function TimelineFileDiffBlockLoading() {
  return (
    <div
      role="status"
      className="mt-1 rounded-lg border border-border bg-background py-1.5 pl-2 pr-3 text-xs leading-5 text-muted-foreground"
    >
      <span className="pl-[1ch]">Loading diff…</span>
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
    preload: "render",
  });
