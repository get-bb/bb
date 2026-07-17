import { describe, expect, it } from "vitest";
import { promptMentionIconName } from "./prompt-mention-display";

describe("promptMentionIconName", () => {
  it("uses the same folder icon for project and folder mentions", () => {
    expect(
      promptMentionIconName({
        kind: "project",
        projectId: "proj_test",
        label: "Test project",
      }),
    ).toBe("Folder");
    expect(
      promptMentionIconName({
        kind: "folder",
        folderId: "fld_test",
        label: "Test folder",
      }),
    ).toBe("Folder");
  });
});
