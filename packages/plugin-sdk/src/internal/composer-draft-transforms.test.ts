import { describe, expect, it } from "vitest";
import type {
  ComposerDraftSnapshot,
  ComposerMention,
} from "../app-contract.js";
import {
  appendQuoteAndAttachmentsToDraft,
  appendQuoteToDraftText,
  removeComposerMentions,
  setComposerText,
} from "./composer-draft-transforms.js";

function emptyDraft(): ComposerDraftSnapshot {
  return { text: "", mentions: [], attachments: [] };
}

it("removes multiple selected pills and rebases surviving UTF-16 ranges without mutating the snapshot", () => {
  const draft: ComposerDraftSnapshot = {
    text: "🙂 @a @keep @b @last",
    mentions: [
      { kind: "thread", threadId: "a", label: "a", from: 3, to: 5 },
      {
        kind: "project",
        projectId: "keep",
        label: "keep",
        from: 6,
        to: 11,
      },
      { kind: "thread", threadId: "b", label: "b", from: 12, to: 14 },
      {
        kind: "project",
        projectId: "last",
        label: "last",
        from: 15,
        to: 20,
      },
    ],
    attachments: [
      {
        type: "localFile",
        path: "spec.txt",
        name: "spec.txt",
        sizeBytes: 1,
      },
    ],
  };
  const next = removeComposerMentions(
    draft,
    (mention) => mention.kind === "thread",
  );
  expect(next.text).toBe("🙂  @keep  @last");
  expect(next.mentions).toMatchObject([
    { from: 4, to: 9, projectId: "keep" },
    { from: 11, to: 16, projectId: "last" },
  ]);
  expect(next.attachments).toBe(draft.attachments);
  expect(draft.text).toBe("🙂 @a @keep @b @last");
  expect(removeComposerMentions(draft, () => false)).toBe(draft);
});

it("reconciles text edits outside pills and drops pills overlapped by the changed span", () => {
  const draft: ComposerDraftSnapshot = {
    attachments: [],
    text: "hi @keep end",
    mentions: [
      { kind: "thread", threadId: "keep", label: "keep", from: 3, to: 8 },
    ],
  };
  const shifted = setComposerText(draft, "🙂 hi @keep end");
  expect(shifted.mentions).toMatchObject([{ from: 6, to: 11 }]);
  expect(setComposerText(shifted, "🙂 hi plain end").mentions).toEqual([]);
  expect(setComposerText(draft, draft.text)).toBe(draft);
  expect(draft.mentions).toMatchObject([{ from: 3, to: 8 }]);
});

describe("appendQuoteToDraftText", () => {
  it("appends a one-line quote to an empty draft with a trailing newline", () => {
    const next = appendQuoteToDraftText(emptyDraft(), "  hello world  ");
    expect(next.text).toBe("> hello world\n");
  });

  it("prefixes each line of a multi-line quote and prefixes blank lines as `>`", () => {
    const next = appendQuoteToDraftText(emptyDraft(), "para one\n\npara two");
    expect(next.text).toBe("> para one\n>\n> para two\n");
  });

  it("appends to existing text separated by a newline", () => {
    const base = { text: "existing reply", mentions: [], attachments: [] };
    const next = appendQuoteToDraftText(base, "quoted");
    expect(next.text).toBe("existing reply\n> quoted\n");
  });

  it("stacks a second quote below the first, separated by a blank line", () => {
    const first = appendQuoteToDraftText(emptyDraft(), "first");
    expect(appendQuoteToDraftText(first, "second").text).toBe(
      "> first\n\n> second\n",
    );
  });

  it("ignores an empty or whitespace-only quote", () => {
    const base = emptyDraft();
    expect(appendQuoteToDraftText(base, "")).toBe(base);
    expect(appendQuoteToDraftText(base, "   \n  ")).toBe(base);
  });

  it("leaves existing mention offsets byte-for-byte unchanged (appends to the end)", () => {
    const text = "Ask @manager now";
    const from = text.indexOf("@manager");
    const mention: ComposerMention = {
      kind: "thread",
      threadId: "thr_parent",
      label: "Prompt UX thread",
      from,
      to: from + "@manager".length,
    };
    const base = { text, mentions: [mention], attachments: [] };

    const next = appendQuoteToDraftText(base, "context");

    expect(next.mentions).toEqual([mention]);
    expect(next.text.startsWith(text)).toBe(true);
  });
});

describe("appendQuoteAndAttachmentsToDraft", () => {
  it("appends a quote and merges new attachments", () => {
    const next = appendQuoteAndAttachmentsToDraft(emptyDraft(), "review this", [
      {
        type: "localImage",
        path: "uploads/screenshot.png",
        name: "screenshot.png",
        sizeBytes: 0,
      },
    ]);

    expect(next).toEqual({
      text: "> review this\n",
      mentions: [],
      attachments: [
        {
          type: "localImage",
          path: "uploads/screenshot.png",
          name: "screenshot.png",
          sizeBytes: 0,
        },
      ],
    });
  });

  it("adds attachments even when there is no quote text", () => {
    const next = appendQuoteAndAttachmentsToDraft(emptyDraft(), "", [
      {
        type: "localFile",
        path: "uploads/spec.md",
        name: "spec.md",
        sizeBytes: 0,
      },
    ]);

    expect(next).toEqual({
      text: "",
      mentions: [],
      attachments: [
        {
          type: "localFile",
          path: "uploads/spec.md",
          name: "spec.md",
          sizeBytes: 0,
        },
      ],
    });
  });

  it("dedupes attachments by path", () => {
    const attachment = {
      type: "localFile" as const,
      path: "uploads/spec.md",
      name: "spec.md",
      sizeBytes: 0,
    };
    const base = {
      text: "",
      mentions: [],
      attachments: [attachment],
    };

    expect(appendQuoteAndAttachmentsToDraft(base, "", [attachment])).toBe(base);
  });
});
