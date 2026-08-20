import { describe, expect, it } from "vitest";
import { queuedMessage } from "../test/fixtures";
import {
  applyQueuedMessageGroupBoundary,
  buildMoveQueuedMessageRequest,
  buildQueuedMessageGroupToggle,
  getQueuedMessageGroupBoundaryIndex,
  preserveLeadQueuedMessageGroupAfterReorder,
  queuedMessageSendGroup,
  removeQueuedMessagesAndRepairGroupEdges,
} from "./queued-message-order";

const grouped = [
  queuedMessage({ id: "a", groupWithNext: true }),
  queuedMessage({ id: "b", groupWithNext: true }),
  queuedMessage({ id: "c" }),
  queuedMessage({ id: "d" }),
];

describe("queued message ordering", () => {
  it("builds neighbour requests for move up / down and refuses the edges", () => {
    expect(buildMoveQueuedMessageRequest(grouped, "c", "up")).toEqual({
      queuedMessageId: "c",
      previousQueuedMessageId: "a",
      nextQueuedMessageId: "b",
    });
    expect(buildMoveQueuedMessageRequest(grouped, "c", "down")).toEqual({
      queuedMessageId: "c",
      previousQueuedMessageId: "d",
      nextQueuedMessageId: null,
    });
    expect(buildMoveQueuedMessageRequest(grouped, "a", "up")).toBeNull();
    expect(buildMoveQueuedMessageRequest(grouped, "d", "down")).toBeNull();
    expect(buildMoveQueuedMessageRequest(grouped, "zz", "up")).toBeNull();
  });

  it("finds the lead group boundary", () => {
    expect(getQueuedMessageGroupBoundaryIndex(grouped)).toBe(2);
    expect(getQueuedMessageGroupBoundaryIndex([grouped[2]!, grouped[3]!])).toBe(
      0,
    );
    expect(getQueuedMessageGroupBoundaryIndex([])).toBe(0);
  });

  it("offers join for rows after the group and split for rows inside it", () => {
    expect(buildQueuedMessageGroupToggle(grouped, "a")).toBeNull();
    expect(buildQueuedMessageGroupToggle(grouped, "d")).toEqual({
      kind: "group-with-above",
      request: {
        expectedGroupedPrefixQueuedMessageIds: ["a", "b", "c", "d"],
        groupBoundaryQueuedMessageId: "d",
      },
    });
    expect(buildQueuedMessageGroupToggle(grouped, "b")).toEqual({
      kind: "send-separately",
      request: {
        expectedGroupedPrefixQueuedMessageIds: ["a"],
        groupBoundaryQueuedMessageId: "a",
      },
    });
    expect(buildQueuedMessageGroupToggle(grouped, "c")).toEqual({
      kind: "send-separately",
      request: {
        expectedGroupedPrefixQueuedMessageIds: ["a", "b"],
        groupBoundaryQueuedMessageId: "b",
      },
    });
  });

  it("applies a boundary as a groupWithNext prefix", () => {
    expect(
      applyQueuedMessageGroupBoundary(grouped, "d").map((m) => m.groupWithNext),
    ).toEqual([true, true, true, false]);
    expect(
      applyQueuedMessageGroupBoundary(grouped, "a").map((m) => m.groupWithNext),
    ).toEqual([false, false, false, false]);
  });

  it("keeps the lead group only while the same ids lead after a reorder", () => {
    const lead = ["a", "b", "c"];
    const swapped = [grouped[1]!, grouped[0]!, grouped[2]!, grouped[3]!];
    expect(
      preserveLeadQueuedMessageGroupAfterReorder(swapped, lead).map(
        (m) => m.groupWithNext,
      ),
    ).toEqual([true, true, false, false]);
    const broken = [grouped[3]!, grouped[0]!, grouped[1]!, grouped[2]!];
    expect(
      preserveLeadQueuedMessageGroupAfterReorder(broken, lead).every(
        (m) => !m.groupWithNext,
      ),
    ).toBe(true);
  });

  it("sends the whole lead group from the first row and one message otherwise", () => {
    expect(queuedMessageSendGroup(grouped, "a").map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(queuedMessageSendGroup(grouped, "b").map((m) => m.id)).toEqual([
      "b",
    ]);
    expect(queuedMessageSendGroup(grouped, "nope")).toEqual([]);
  });

  it("repairs the group edge when removing the next message", () => {
    const next = removeQueuedMessagesAndRepairGroupEdges(
      grouped,
      new Set(["c"]),
    );
    expect(next?.map((m) => [m.id, m.groupWithNext])).toEqual([
      ["a", true],
      ["b", false],
      ["d", false],
    ]);
  });
});
