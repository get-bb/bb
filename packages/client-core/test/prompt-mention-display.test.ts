import { describe, expect, it } from "vitest";
import { promptMentionIconName } from "../src/prompt/mentions/prompt-mention-display.js";

describe("promptMentionIconName", () => {
  it("uses distinct icons for threads, projects, and sections", () => {
    expect(
      promptMentionIconName({
        kind: "thread",
        threadId: "thr_test",
        label: "Test thread",
      }),
    ).toBe("UserRound");
    expect(
      promptMentionIconName({
        kind: "project",
        projectId: "proj_test",
        label: "Test project",
      }),
    ).toBe("Folder");
    expect(
      promptMentionIconName({
        kind: "section",
        sectionId: "sec_test",
        label: "Test section",
      }),
    ).toBe("SectionAdd");
  });
});
