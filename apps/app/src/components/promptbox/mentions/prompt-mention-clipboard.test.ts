// @vitest-environment jsdom

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

  it("serializes a folder mention as an @folder token", () => {
    expect(
      serializedTextForPromptMentionResource({
        kind: "folder",
        folderId: "fld_abc",
        label: "Release work",
      }),
    ).toBe("@folder:fld_abc");
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

describe("parsePromptMentionClipboardElement", () => {
  it("preserves the typed trigger for a plugin mention copied from a pill", () => {
    const element = document.createElement("span");
    const resource = {
      kind: "plugin" as const,
      pluginId: "github",
      icon: null,
      itemId: "issue:owner/repo#42",
      label: "#42 Fix login bug",
    };
    for (const [key, value] of Object.entries(
      promptMentionClipboardDataAttributes({
        resource,
        serializedText: "#42 Fix login bug",
      }),
    )) {
      element.setAttribute(key, value);
    }

    expect(parsePromptMentionClipboardElement({ element })).toEqual({
      resource,
      serializedText: "#42 Fix login bug",
    });
  });

  it("rejects plugin mention clipboard text that does not match the resource label", () => {
    const element = document.createElement("span");
    for (const [key, value] of Object.entries(
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
    )) {
      element.setAttribute(key, value);
    }

    expect(parsePromptMentionClipboardElement({ element })).toBeNull();
  });
});
