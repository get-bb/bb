import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import type { ThreadEventItemPresentation } from "@bb/domain";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

function flattenRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" && row.children
      ? [row, ...flattenRows(row.children)]
      : [row],
  );
}

function activityIntents(rows: readonly TimelineRow[]) {
  return flattenRows(rows).flatMap((row) =>
    row.kind === "work" && row.workKind === "tool"
      ? row.activityIntents.map((intent) => ({
          ...intent,
          status: row.status,
        }))
      : [],
  );
}

const READ_PRESENTATION: ThreadEventItemPresentation = {
  label: { pending: "Searching tools", completed: "Searched tools" },
  icon: { glyph: "Toolbox" },
  suppress: true,
};

/**
 * Grammar v3 `fileRead` and `search` items project to the same activity
 * intents the legacy structured Read/Grep/Glob tool calls produced, so a
 * migrated bridge's reads and searches keep rendering as "Read x" /
 * "Searched for y" bundles until the presentation-driven projection lands.
 */
describe("v3 exploration item projection", () => {
  it("renders fileRead and search items with the legacy tool calls' intents", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const v3 = renderTimelineFixture({
      events: [
        event.turnStarted({ turnId: "turn-1", createdAt: 0 }),
        event.fileReadStarted({
          turnId: "turn-1",
          itemId: "read-1",
          path: "src/index.ts",
          createdAt: 1_000,
        }),
        event.fileReadCompleted({
          turnId: "turn-1",
          itemId: "read-1",
          path: "src/index.ts",
          createdAt: 2_000,
        }),
        event.searchStarted({
          turnId: "turn-1",
          itemId: "grep-1",
          mode: "content",
          query: "TODO",
          path: "src",
          createdAt: 3_000,
        }),
        event.searchCompleted({
          turnId: "turn-1",
          itemId: "grep-1",
          mode: "content",
          query: "TODO",
          path: "src",
          createdAt: 4_000,
        }),
        event.searchStarted({
          turnId: "turn-1",
          itemId: "glob-1",
          mode: "path",
          query: "**/*.ts",
          path: "src",
          createdAt: 5_000,
        }),
        event.searchCompleted({
          turnId: "turn-1",
          itemId: "glob-1",
          mode: "path",
          query: "**/*.ts",
          path: "src",
          createdAt: 6_000,
        }),
        event.turnCompleted({ turnId: "turn-1", createdAt: 7_000 }),
      ],
      projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    });
    const legacy = renderTimelineFixture({
      events: [
        event.turnStarted({ turnId: "turn-1", createdAt: 0 }),
        event.toolCallStarted({
          turnId: "turn-1",
          itemId: "read-1",
          tool: "Read",
          arguments: { file_path: "src/index.ts" },
          createdAt: 1_000,
        }),
        event.toolCallCompleted({
          turnId: "turn-1",
          itemId: "read-1",
          tool: "Read",
          arguments: { file_path: "src/index.ts" },
          createdAt: 2_000,
        }),
        event.toolCallStarted({
          turnId: "turn-1",
          itemId: "grep-1",
          tool: "Grep",
          arguments: { pattern: "TODO", path: "src" },
          createdAt: 3_000,
        }),
        event.toolCallCompleted({
          turnId: "turn-1",
          itemId: "grep-1",
          tool: "Grep",
          arguments: { pattern: "TODO", path: "src" },
          createdAt: 4_000,
        }),
        event.toolCallStarted({
          turnId: "turn-1",
          itemId: "glob-1",
          tool: "Glob",
          arguments: { pattern: "**/*.ts", path: "src" },
          createdAt: 5_000,
        }),
        event.toolCallCompleted({
          turnId: "turn-1",
          itemId: "glob-1",
          tool: "Glob",
          arguments: { pattern: "**/*.ts", path: "src" },
          createdAt: 6_000,
        }),
        event.turnCompleted({ turnId: "turn-1", createdAt: 7_000 }),
      ],
      projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    });

    // The command text and the read intent's tool name differ by design (a
    // v3 item has no tool); everything the bundles render from is equal.
    const strip = (intents: ReturnType<typeof activityIntents>) =>
      intents.map(({ command: _command, ...rest }) =>
        rest.type === "read" ? { ...rest, name: "" } : rest,
      );
    expect(activityIntents(v3.rows)).toHaveLength(3);
    expect(strip(activityIntents(v3.rows))).toEqual(
      strip(activityIntents(legacy.rows)),
    );
    expect(activityIntents(v3.rows)).toEqual([
      expect.objectContaining({
        type: "read",
        path: "src/index.ts",
        status: "completed",
      }),
      expect.objectContaining({
        type: "search",
        query: "TODO",
        path: "src",
        status: "completed",
      }),
      expect.objectContaining({
        type: "list_files",
        path: "src",
        status: "completed",
      }),
    ]);
  });

  it("hides a tool call the bridge marked suppress in its presentation", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const rendered = renderTimelineFixture({
      events: [
        event.turnStarted({ turnId: "turn-1", createdAt: 0 }),
        event.toolCallStarted({
          turnId: "turn-1",
          itemId: "ts-1",
          tool: "Monitor",
          arguments: { command: "tail -f log" },
          presentation: READ_PRESENTATION,
          createdAt: 1_000,
        }),
        event.toolCallCompleted({
          turnId: "turn-1",
          itemId: "ts-1",
          tool: "Monitor",
          arguments: { command: "tail -f log" },
          presentation: READ_PRESENTATION,
          createdAt: 2_000,
        }),
        event.toolCallStarted({
          turnId: "turn-1",
          itemId: "keep-1",
          tool: "Monitor",
          arguments: { command: "tail -f log" },
          createdAt: 3_000,
        }),
        event.toolCallCompleted({
          turnId: "turn-1",
          itemId: "keep-1",
          tool: "Monitor",
          arguments: { command: "tail -f log" },
          createdAt: 4_000,
        }),
        // A failed call renders even when suppressed: failures are never noise.
        event.toolCallStarted({
          turnId: "turn-1",
          itemId: "fail-1",
          tool: "Monitor",
          presentation: READ_PRESENTATION,
          createdAt: 5_000,
        }),
        event.toolCallCompleted({
          turnId: "turn-1",
          itemId: "fail-1",
          tool: "Monitor",
          presentation: READ_PRESENTATION,
          status: "failed",
          error: "boom",
          createdAt: 6_000,
        }),
        event.turnCompleted({ turnId: "turn-1", createdAt: 7_000 }),
      ],
      projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    });
    const callIds = flattenRows(rendered.rows).flatMap((row) =>
      row.kind === "work" && row.workKind === "tool" ? [row.callId] : [],
    );
    expect(callIds).toEqual(["keep-1", "fail-1"]);
  });
});
