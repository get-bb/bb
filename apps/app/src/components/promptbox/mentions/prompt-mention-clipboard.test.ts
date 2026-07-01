import { describe, expect, it } from "vitest";
import { serializedTextForPromptMentionResource } from "./prompt-mention-clipboard";

describe("serializedTextForPromptMentionResource", () => {
  it("serializes a project mention as an @project token", () => {
    expect(
      serializedTextForPromptMentionResource({
        kind: "project",
        projectId: "proj_abc",
        label: "Alpha Service",
      }),
    ).toBe("@project:proj_abc");
  });

  it("serializes a thread mention as an @thread token", () => {
    expect(
      serializedTextForPromptMentionResource({
        kind: "thread",
        threadId: "thr_abc",
        projectId: "proj_abc",
        label: "Some thread",
      }),
    ).toBe("@thread:thr_abc");
  });
});
