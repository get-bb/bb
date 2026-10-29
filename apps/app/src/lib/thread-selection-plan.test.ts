import { describe, expect, it } from "vitest";
import { makeThread } from "@bb/test-helpers/domain-fixtures";
import { summarizeThreadSelection } from "./thread-selection-plan";

describe("summarizeThreadSelection", () => {
  it("acts on the topmost selected threads and counts only unselected descendants once", () => {
    const parent = makeThread({ id: "parent" });
    const child = makeThread({ id: "child", parentThreadId: "parent" });
    const grandchild = makeThread({
      id: "grandchild",
      parentThreadId: "middle",
    });
    const other = makeThread({ id: "other" });
    const plan = summarizeThreadSelection(
      [parent, child, grandchild, other],
      [
        {
          threadId: "parent",
          cascadeThreadIds: ["child", "middle", "grandchild", "leaf"],
        },
        { threadId: "child", cascadeThreadIds: [] },
        { threadId: "grandchild", cascadeThreadIds: ["leaf"] },
        { threadId: "other", cascadeThreadIds: ["other-child"] },
      ],
    );
    expect(plan.roots.map((thread) => thread.id)).toEqual(["parent", "other"]);
    expect(plan.childThreadCount).toBe(3);
    expect(plan.cascadeThreadIdsByRootId.get("other")).toEqual(["other-child"]);
  });
});
