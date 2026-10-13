import { defineSplit } from "@/lib/define-split";
import type { TerminalOutputBlockProps } from "./TerminalOutputBlock.js";
import { TimelineRowBodyPlaceholder } from "./TimelineRowBodyPlaceholder.js";

export const LazyTerminalOutputBlock = defineSplit<TerminalOutputBlockProps>({
  id: "timeline-terminal-output",
  load: () =>
    import("./TerminalOutputBlock.js").then(
      (module) => module.TerminalOutputBlock,
    ),
  loading: () => <TimelineRowBodyPlaceholder />,
  tier: "intent",
});
