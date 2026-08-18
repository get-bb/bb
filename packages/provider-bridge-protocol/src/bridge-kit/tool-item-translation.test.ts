import { describe, expect, it } from "vitest";
import { buildFileChangeItem } from "./tool-item-translation.js";

describe("buildFileChangeItem", () => {
  it("carries the caller's callId as the item id", () => {
    const item = buildFileChangeItem({
      callId: "call-7",
      path: "src/app.ts",
      oldText: "foo()",
      newText: "bar()",
    });
    expect(item.id).toBe("call-7");
    expect(item.changes).toEqual([
      {
        path: "src/app.ts",
        kind: "update",
        diff: expect.stringContaining("-foo()"),
      },
    ]);
  });

  it("classifies a change without oldText as an add", () => {
    const item = buildFileChangeItem({
      callId: "call-8",
      path: "new.ts",
      newText: "hello",
    });
    expect(item.changes[0]?.kind).toBe("add");
  });
});
