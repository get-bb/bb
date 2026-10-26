import { useDiffRendererLoad } from "@/components/code/useCodeRendererLoad";
import { defineSplit } from "@/lib/define-split";
import type { TimelineFileDiffBlockProps } from "./TimelineFileDiffBlock.js";
import { TimelineRowBodyPlaceholder } from "./TimelineRowBodyPlaceholder.js";

const TimelineFileDiffBlockSplit = defineSplit<TimelineFileDiffBlockProps>({
  id: "timeline-file-diff",
  load: () =>
    import("./TimelineFileDiffBlock.js").then(
      (module) => module.TimelineFileDiffBlock,
    ),
  loading: () => <TimelineRowBodyPlaceholder />,
  tier: "intent",
});

export const LazyTimelineFileDiffBlock = Object.assign(
  function LazyTimelineFileDiffBlock(props: TimelineFileDiffBlockProps) {
    useDiffRendererLoad();
    return <TimelineFileDiffBlockSplit {...props} />;
  },
  TimelineFileDiffBlockSplit,
);
