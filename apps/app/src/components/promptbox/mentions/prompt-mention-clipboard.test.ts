import { describe, expect, it } from "vitest";
import {
  parsePromptMentionClipboardElement,
  promptMentionClipboardDataAttributes,
  serializedTextForPromptMentionResource,
} from "./prompt-mention-clipboard";

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

  it("serializes a section mention as an @section token", () => {
    expect(
      serializedTextForPromptMentionResource({
        kind: "section",
        sectionId: "sec_abc",
        label: "Release work",
      }),
    ).toBe("@section:sec_abc");
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

function attributeElement(
  attributes: ReturnType<typeof promptMentionClipboardDataAttributes>,
): Pick<Element, "getAttribute"> {
  const values = new Map<string, string>(Object.entries(attributes));
  return { getAttribute: (name) => values.get(name) ?? null };
}

describe("parsePromptMentionClipboardElement", () => {
  it("preserves the typed trigger for a plugin mention copied from a pill", () => {
    const resource = {
      kind: "plugin" as const,
      pluginId: "github",
      icon: null,
      itemId: "issue:owner/repo#42",
      label: "#42 Fix login bug",
    };
    const element = attributeElement(
      promptMentionClipboardDataAttributes({
        resource,
        serializedText: "#42 Fix login bug",
      }),
    );

    expect(parsePromptMentionClipboardElement({ element })).toEqual({
      resource,
      serializedText: "#42 Fix login bug",
    });
  });

  it("rejects plugin mention clipboard text that does not match the resource label", () => {
    const element = attributeElement(
      promptMentionClipboardDataAttributes({
        resource: {
          kind: "plugin",
          pluginId: "github",
          icon: null,
          itemId: "issue:owner/repo#42",
          label: "#42 Fix login bug",
        },
        serializedText: "#999 Different issue",
      }),
    );

    expect(parsePromptMentionClipboardElement({ element })).toBeNull();
  });
});
