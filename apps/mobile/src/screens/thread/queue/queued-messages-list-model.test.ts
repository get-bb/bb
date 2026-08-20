import { describe, expect, it } from "vitest";
import { queuedMessage } from "@/data/test/fixtures";
import { buildQueuedMessageRowModels } from "./queued-messages-list-model";

describe("buildQueuedMessageRowModels", () => {
  it("marks the lead group and offers the right moves per row", () => {
    const rows = buildQueuedMessageRowModels([
      queuedMessage({ id: "a", groupWithNext: true }),
      queuedMessage({ id: "b" }),
      queuedMessage({
        id: "c",
        content: [
          { type: "text", text: "", mentions: [] },
          { type: "localFile", path: "/tmp/report.pdf" },
        ],
      }),
    ]);
    expect(
      rows.map((row) => [row.id, row.inLeadGroup, row.isGroupBoundary]),
    ).toEqual([
      ["a", true, false],
      ["b", true, true],
      ["c", false, false],
    ]);
    expect(rows[0]?.moveUp).toBeNull();
    expect(rows[0]?.moveDown?.previousQueuedMessageId).toBe("b");
    expect(rows[2]?.moveDown).toBeNull();
    expect(rows[2]?.preview).toBe("Attachment only (report.pdf)");
    expect(rows[2]?.attachmentCount).toBe(1);
    expect(rows[0]?.groupToggle).toBeNull();
    expect(rows[1]?.groupToggle?.kind).toBe("send-separately");
    expect(rows[2]?.groupToggle?.kind).toBe("group-with-above");
  });

  it("shows no group chrome for a single or ungrouped queue", () => {
    const rows = buildQueuedMessageRowModels([
      queuedMessage({ id: "a" }),
      queuedMessage({ id: "b" }),
    ]);
    expect(rows.every((row) => !row.inLeadGroup && !row.isGroupBoundary)).toBe(
      true,
    );
    expect(rows[1]?.groupToggle?.kind).toBe("group-with-above");
  });
});
