import { useState } from "react";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { SplitPreviewProvider } from "@/lib/define-split";
import {
  commandRow,
  conversationRow,
  toolRow,
} from "@/test/fixtures/thread-timeline-rows";
import { LazyTerminalOutputBlock } from "./LazyTerminalOutputBlock";

export default { title: "performance/Split review/Timeline terminal output" };

const workspaceRootPath = "/Users/michael/.bb-dev/worktrees/env_story/bb";

const failedTestRow = commandRow({
  id: "thr_story:command:split_review_test",
  callId: "call_split_review_test",
  command: "pnpm exec vitest run src/lib/format-duration.test.ts",
  exitCode: 1,
  sourceSeqStart: 1,
  sourceSeqEnd: 2,
  output: [
    "\u001b[1m\u001b[46m RUN \u001b[49m\u001b[22m \u001b[36mv3.2.4 \u001b[39m\u001b[90m/workspace/bb/apps/app\u001b[39m",
    "",
    " \u001b[32m✓\u001b[39m formats milliseconds \u001b[90m1ms\u001b[39m",
    " \u001b[31m×\u001b[39m rounds to whole seconds \u001b[90m3ms\u001b[39m",
    "",
    "\u001b[31m\u001b[1mAssertionError\u001b[22m: expected '1.5s' to be '2s'\u001b[39m",
    "",
    " \u001b[2mTest Files \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m",
    " \u001b[2m     Tests \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m | \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m",
  ].join("\n"),
});

const testNoteRow = conversationRow({
  id: "thr_story:assistant:split_review_test_note",
  sourceSeqStart: 3,
  text: "One rounding test fails. Reading the formatter next.",
});

const readRow = toolRow({
  id: "thr_story:tool:split_review_read",
  callId: "call_split_review_read",
  toolName: "Read",
  toolArgs: { path: "apps/app/src/lib/format-duration.ts" },
  output: "export function formatDuration(ms: number): string {",
  sourceSeqStart: 4,
  sourceSeqEnd: 5,
});

const streamingLines = [
  "\u001b[36mbuilding\u001b[39m apps/app",
  "\u001b[32m✓\u001b[39m 2143 modules transformed.",
  "\u001b[33mwarning\u001b[39m chunk larger than 500 kB",
  "\u001b[32m✓\u001b[39m built in 4.21s",
];

const readNoteRow = conversationRow({
  id: "thr_story:assistant:split_review_read_note",
  sourceSeqStart: 6,
  text: "Building the app to check the bundle.",
});

const buildRowId = "thr_story:command:split_review_build";

const initialExpanded = new Set([failedTestRow.id, buildRowId]);

const followingRow = conversationRow({
  id: "thr_story:assistant:split_review_terminal",
  sourceSeqStart: 20,
  text: "The rounding test fails; seconds should round half up.",
});

export function TimelineTerminalOutput() {
  const [state, setState] = useState<"loading" | "error" | "live">("loading");
  const [streamedLines, setStreamedLines] = useState(1);
  const buildRow = commandRow({
    id: buildRowId,
    callId: "call_split_review_build",
    command: "pnpm exec turbo run build --filter=@bb/app",
    exitCode: streamedLines >= streamingLines.length ? 0 : null,
    status: streamedLines >= streamingLines.length ? "completed" : "pending",
    sourceSeqStart: 7,
    sourceSeqEnd: 7 + streamedLines,
    output: streamingLines.slice(0, streamedLines).join("\n"),
  });
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
        <button
          type="button"
          disabled={streamedLines >= streamingLines.length}
          onClick={() => setStreamedLines((count) => count + 1)}
        >
          Append build output
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {LazyTerminalOutputBlock.id}: {state}
      </p>
      <div className="w-full max-w-[760px]">
        <SplitPreviewProvider
          id={
            state === "live"
              ? `${LazyTerminalOutputBlock.id}:released`
              : LazyTerminalOutputBlock.id
          }
          state={state === "error" ? "error" : "loading"}
          onRetry={() => setState("live")}
        >
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={workspaceRootPath}
            initialExpanded={initialExpanded}
            timelineRows={[
              failedTestRow,
              testNoteRow,
              readRow,
              readNoteRow,
              buildRow,
              followingRow,
            ]}
          />
        </SplitPreviewProvider>
      </div>
    </div>
  );
}
