import { turnScope, type ThreadEventFileChange } from "@bb/domain";
import { expect, it } from "vitest";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "../src/index.js";
import { workRowsOfKind } from "./timeline-test-harness.js";

function fileEvents(
  fileCount: number,
  reverse: boolean,
): ThreadEventWithMeta[] {
  const changes: ThreadEventFileChange[] = Array.from(
    { length: fileCount },
    (_, index) => ({ path: `generated/module-${index}.ts`, kind: "update" }),
  );
  return [
    {
      event: {
        type: "turn/started",
        threadId: "scaling-thread",
        providerThreadId: "scaling-provider",
        scope: turnScope("scaling-turn"),
      },
      meta: { id: "turn-start", seq: 0, createdAt: 0 },
    },
    ...(["item/started", "item/completed"] as const).map(
      (type, index): ThreadEventWithMeta => ({
        event: {
          type,
          threadId: "scaling-thread",
          providerThreadId: "scaling-provider",
          scope: turnScope("scaling-turn"),
          item: {
            type: "fileChange",
            id: "generated-edit",
            changes: index === 1 && reverse ? [...changes].reverse() : changes,
            status: index === 0 ? "pending" : "completed",
            approvalStatus: null,
          },
        },
        meta: { id: type, seq: index + 1, createdAt: index + 1 },
      }),
    ),
  ];
}

function build(events: ThreadEventWithMeta[]) {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events,
    options: {
      completedTurnDisplay: "collapse",
      includeNestedRows: true,
      omitSettledDelegationChildRows: false,
      includeDiagnosticOperations: false,
      summarizeShellCommands: true,
      isLatestPage: true,
      threadStatus: "idle",
      threadName: "",
      workspaceRoot: null,
    },
  });
}

function minimumBuildTime(events: ThreadEventWithMeta[]): number {
  for (let warmup = 0; warmup < 4; warmup++) build(events);
  let minimum = Infinity;
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    for (let repeat = 0; repeat < 3; repeat++) build(events);
    minimum = Math.min(minimum, (performance.now() - start) / 3);
  }
  return minimum;
}

it.each([false, true])(
  "keeps large file-change timeline builds within a linear scaling budget (reversed: %s)",
  (reverse) => {
    const small = fileEvents(256, reverse);
    const large = fileEvents(4096, reverse);
    expect(workRowsOfKind(build(large).rows, "file-change")).toHaveLength(4096);
    const smallMs = minimumBuildTime(small);
    const largeMs = minimumBuildTime(large);
    const ratio = largeMs / smallMs;
    console.log(JSON.stringify({ reverse, smallMs, largeMs, ratio }));
    expect(ratio).toBeLessThan(64);
  },
  30_000,
);
