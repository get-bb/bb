import { defineSplit } from "@/lib/define-split";
import type { TimelineFileDiffBlockProps } from "./TimelineFileDiffBlock.js";
import { TimelineRowBodyPlaceholder } from "./TimelineRowBodyPlaceholder.js";

export const LazyTimelineFileDiffBlock =
  defineSplit<TimelineFileDiffBlockProps>({
    id: "timeline-file-diff",
    load: () =>
      import("./TimelineFileDiffBlock.js").then(
        (module) => module.TimelineFileDiffBlock,
      ),
    loading: () => <TimelineRowBodyPlaceholder shape="block" />,
    tier: "intent",
  });
