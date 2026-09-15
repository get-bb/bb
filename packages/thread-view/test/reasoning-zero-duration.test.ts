import { describe, expect, it } from "vitest";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

describe("completed reasoning duration", () => {
  it.each([
    { completedAt: 4_000, title: "Thought" },
    { completedAt: 3_000, title: "Thought" },
    { completedAt: 4_500, title: "Thought for 500ms" },
  ])(
    "renders $title when completion is $completedAt",
    ({ completedAt, title }) => {
      const event = createTimelineEventFactory({ threadId: "thread-1" });
      const persistedAt = 4_000;
      const timeline = renderTimelineFixture({
        events: [
          event.turnStarted({ createdAt: 0 }),
          event.reasoningStarted({
            createdAt: persistedAt,
            itemId: "reasoning-1",
          }),
          event.reasoningDelta({
            createdAt: persistedAt,
            delta: "Checking the projection.",
            itemId: "reasoning-1",
          }),
          event.reasoningCompleted({
            createdAt: completedAt,
            itemId: "reasoning-1",
            text: "Checked the projection.",
          }),
          event.turnCompleted({ createdAt: 5_000 }),
        ],
        projectionOptions: {
          threadStatus: "idle",
          turnMessageDetail: "summary",
        },
      });

      const reasoning = timeline.messages.find(
        (message) =>
          message.kind === "operation" &&
          message.detail === "Checked the projection.",
      );
      expect(reasoning).toMatchObject({
        completedAt,
        startedAt: persistedAt,
        title,
      });
      expect(timeline.text).toContain(`── ${title}\n`);
      expect(timeline.text).not.toContain("Thought for 0ms");
    },
  );
});
