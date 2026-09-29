import { useState } from "react";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { SplitPreviewProvider } from "@/lib/define-split";
import {
  conversationRow,
  fileChangeRow,
} from "@/test/fixtures/thread-timeline-rows";
import { LazyTimelineFileDiffBlock } from "./LazyTimelineFileDiffBlock";

export default { title: "performance/Split review/Timeline diff" };

const workspaceRootPath = "/Users/michael/.bb-dev/worktrees/env_story/bb";

const updateRow = fileChangeRow({
  id: "thr_story:file-change:call_split_review:0",
  callId: "call_split_review",
  sourceSeqStart: 1,
  sourceSeqEnd: 2,
  change: {
    path: `${workspaceRootPath}/apps/app/src/lib/format-duration.ts`,
    kind: "update",
    movePath: null,
    diff: "@@ -1,6 +1,9 @@\n export function formatDuration(ms: number): string {\n-  return `${ms}ms`;\n+  if (ms < 1000) {\n+    return `${ms}ms`;\n+  }\n+  return `${Math.round(ms / 1000)}s`;\n }\n \n export const DEFAULT_TIMEOUT_MS = 30_000;\n",
    diffStats: { added: 4, removed: 1 },
  },
});

const followingRow = conversationRow({
  id: "thr_story:assistant:split_review",
  sourceSeqStart: 3,
  text: "Seconds now round to the nearest whole second.",
});

export function TimelineDiff() {
  const [state, setState] = useState<"loading" | "error" | "live">("loading");
  const rows = (
    <ThreadTimelineRows
      threadRuntimeDisplayStatus="idle"
      workspaceRootPath={workspaceRootPath}
      initialExpanded={new Set([updateRow.id])}
      timelineRows={[updateRow, followingRow]}
    />
  );
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-3" aria-label="Split review controls">
        <button type="button" onClick={() => setState("loading")}>
          Hold loading
        </button>
        <button type="button" onClick={() => setState("error")}>
          Show failure
        </button>
        <button type="button" onClick={() => setState("live")}>
          Release to real UI
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {LazyTimelineFileDiffBlock.id}: {state}
      </p>
      <div className="w-full max-w-[760px]">
        {state === "live" ? (
          rows
        ) : (
          <SplitPreviewProvider
            id={LazyTimelineFileDiffBlock.id}
            state={state}
            onRetry={() => setState("live")}
          >
            {rows}
          </SplitPreviewProvider>
        )}
      </div>
    </div>
  );
}
