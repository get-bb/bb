import { Skeleton } from "@bb/shared-ui/skeleton";
import { defineSplit } from "@/lib/define-split";
import type { TerminalOutputBlockProps } from "./TerminalOutputBlock.js";

function TerminalOutputBlockLoading() {
  return (
    <div
      role="status"
      aria-label="Loading output"
      className="space-y-2 rounded-lg border border-border bg-card px-4 py-3"
    >
      <Skeleton className="h-3 w-2/5 rounded-sm" />
      <Skeleton className="h-3 w-3/4 rounded-sm" />
    </div>
  );
}

export const LazyTerminalOutputBlock = defineSplit<TerminalOutputBlockProps>({
  id: "timeline-terminal-output",
  load: () =>
    import("./TerminalOutputBlock.js").then(
      (module) => module.TerminalOutputBlock,
    ),
  loading: TerminalOutputBlockLoading,
  tier: "intent",
});
