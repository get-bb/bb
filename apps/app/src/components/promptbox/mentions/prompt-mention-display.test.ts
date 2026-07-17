import { describe, expect, it } from "vitest";
import { promptMentionIconName } from "./prompt-mention-display";

describe("promptMentionIconName", () => {
  it("uses a folder icon for projects and no icon for sections", () => {
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
    ).toBeNull();
  });
});
