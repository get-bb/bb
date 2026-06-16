import { describe, expect, it } from "vitest";
import type { PromptMentionResource } from "@bb/domain";
import {
  addQuoteToDraft,
  emptyPromptDraftState,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  promptDraftToInput,
  promptInputToDraft,
  removeQuoteFromDraft,
  serializePromptDraftStorage,
} from "./prompt-draft";

describe("prompt draft helpers", () => {
  it("drops invalid legacy raw text drafts", () => {
    const parsed = parsePromptDraftStorage("Investigate flaky login redirect");
    expect(parsed).toEqual({
      text: "",
      mentions: [],
      attachments: [],
      quotes: [],
    });
  });

  it("parses structured drafts with attachments", () => {
    const parsed = parsePromptDraftStorage(
      JSON.stringify({
        text: "Review",
        attachments: [
          {
            type: "localImage",
            path: "/tmp/image.png",
            name: "image.png",
            sizeBytes: 12,
            mimeType: "image/png",
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      text: "Review",
      mentions: [],
      attachments: [
        {
          type: "localImage",
          path: "/tmp/image.png",
          name: "image.png",
          sizeBytes: 12,
          mimeType: "image/png",
        },
      ],
      quotes: [],
    });
  });

  it("detects whether a draft has any submittable state", () => {
    expect(isPromptDraftEmpty(emptyPromptDraftState())).toBe(true);
    expect(
      isPromptDraftEmpty({
        text: "",
        mentions: [],
        attachments: [
          {
            type: "localFile",
            path: "/tmp/spec.md",
            name: "spec.md",
            sizeBytes: 42,
            mimeType: "text/markdown",
          },
        ],
        quotes: [],
      }),
    ).toBe(false);
  });

  it("maps draft text and attachments to prompt input list", () => {
    const input = promptDraftToInput({
      text: "  Ship this patch  ",
      mentions: [],
      quotes: [],
      attachments: [
        {
          type: "localImage",
          path: "/tmp/image.png",
          name: "image.png",
          sizeBytes: 32,
          mimeType: "image/png",
        },
        {
          type: "localFile",
          path: "/tmp/spec.md",
          name: "spec.md",
          sizeBytes: 42,
          mimeType: "text/markdown",
        },
      ],
    });

    expect(input).toEqual([
      { type: "text", text: "Ship this patch", mentions: [] },
      { type: "localImage", path: "/tmp/image.png" },
      {
        type: "localFile",
        path: "/tmp/spec.md",
        name: "spec.md",
        sizeBytes: 42,
        mimeType: "text/markdown",
      },
    ]);
  });

  it("keeps visible mention ranges when trailing trim clips mention whitespace", () => {
    const resource: PromptMentionResource = {
      kind: "thread",
      threadId: "thr_parent",
      label: "Prompt UX thread",
    };
    const text = "  Ask @manager   ";
    const token = "@manager";
    const start = text.indexOf(token);
    if (start < 0) {
      throw new Error("Expected mention token in test text");
    }

    const input = promptDraftToInput({
      text,
      mentions: [
        {
          start,
          end: text.length,
          resource,
        },
      ],
      attachments: [],
      quotes: [],
    });

    expect(input).toEqual([
      {
        type: "text",
        text: "Ask @manager",
        mentions: [
          {
            start: "Ask ".length,
            end: "Ask @manager".length,
            resource,
          },
        ],
      },
    ]);
  });

  it("maps prompt input back to an editable draft", () => {
    const draft = promptInputToDraft([
      { type: "text", text: "Investigate", mentions: [] },
      { type: "image", url: "https://example.com/image.png" },
      { type: "localImage", path: "/tmp/screenshot.png" },
      {
        type: "localFile",
        path: "/tmp/spec.md",
        name: "spec.md",
        sizeBytes: 42,
        mimeType: "text/markdown",
      },
    ]);

    expect(draft).toEqual({
      text: "Investigate",
      mentions: [],
      attachments: [
        {
          type: "localImage",
          path: "/tmp/screenshot.png",
          name: "screenshot.png",
          sizeBytes: 0,
        },
        {
          type: "localFile",
          path: "/tmp/spec.md",
          name: "spec.md",
          sizeBytes: 42,
          mimeType: "text/markdown",
        },
      ],
      quotes: [],
    });
  });
});

describe("prompt draft quotes", () => {
  it("defaults quotes to an empty array in every constructor", () => {
    expect(emptyPromptDraftState().quotes).toEqual([]);
    expect(
      promptInputToDraft([{ type: "text", text: "Hi", mentions: [] }]).quotes,
    ).toEqual([]);
    expect(parsePromptDraftStorage(null).quotes).toEqual([]);
  });

  it("rehydrates legacy stored drafts without quotes to quotes: []", () => {
    const parsed = parsePromptDraftStorage(
      JSON.stringify({ text: "Review", attachments: [] }),
    );
    expect(parsed.quotes).toEqual([]);
  });

  it("round-trips a draft serialized without quotes back to quotes: []", () => {
    const serialized = serializePromptDraftStorage({
      text: "Review",
      mentions: [],
      attachments: [],
      quotes: [],
    });
    expect(serialized).not.toBeNull();
    const parsed = parsePromptDraftStorage(serialized);
    expect(parsed.quotes).toEqual([]);
  });

  it("appends a trimmed quote with a generated id", () => {
    const state = addQuoteToDraft(emptyPromptDraftState(), "  hello world  ");
    expect(state.quotes).toHaveLength(1);
    expect(state.quotes[0]?.text).toBe("hello world");
    expect(state.quotes[0]?.id).toEqual(expect.any(String));
  });

  it("ignores an empty or whitespace-only quote", () => {
    const base = emptyPromptDraftState();
    expect(addQuoteToDraft(base, "").quotes).toEqual([]);
    expect(addQuoteToDraft(base, "   \n  ").quotes).toEqual([]);
  });

  it("removes a quote by id without mutating the input state", () => {
    const added = addQuoteToDraft(emptyPromptDraftState(), "keep me");
    const id = added.quotes[0]?.id ?? "";
    const removed = removeQuoteFromDraft(added, id);
    expect(removed.quotes).toEqual([]);
    expect(added.quotes).toHaveLength(1);
  });

  it("emits no extra part when there are no quotes", () => {
    const input = promptDraftToInput({
      text: "Ship it",
      mentions: [],
      attachments: [],
      quotes: [],
    });
    expect(input).toEqual([{ type: "text", text: "Ship it", mentions: [] }]);
  });

  it("emits a separate leading blockquote part ahead of the user text", () => {
    const input = promptDraftToInput({
      text: "Please explain",
      mentions: [],
      attachments: [],
      quotes: [{ id: "q1", text: "first line\nsecond line" }],
    });
    expect(input).toEqual([
      { type: "text", text: "> first line\n> second line", mentions: [] },
      { type: "text", text: "Please explain", mentions: [] },
    ]);
  });

  it("prefixes blank lines in a multi-paragraph selection", () => {
    const input = promptDraftToInput({
      text: "",
      mentions: [],
      attachments: [],
      quotes: [{ id: "q1", text: "para one\n\npara two" }],
    });
    expect(input).toEqual([
      { type: "text", text: "> para one\n> \n> para two", mentions: [] },
    ]);
  });

  it("separates consecutive quotes with a single blank line", () => {
    const input = promptDraftToInput({
      text: "",
      mentions: [],
      attachments: [],
      quotes: [
        { id: "q1", text: "alpha" },
        { id: "q2", text: "beta" },
      ],
    });
    expect(input).toEqual([
      { type: "text", text: "> alpha\n\n> beta", mentions: [] },
    ]);
  });

  it("nests an existing blockquote in the selection", () => {
    const input = promptDraftToInput({
      text: "",
      mentions: [],
      attachments: [],
      quotes: [{ id: "q1", text: "> already quoted\nplain" }],
    });
    expect(input).toEqual([
      { type: "text", text: "> > already quoted\n> plain", mentions: [] },
    ]);
  });

  it("keeps code fences and list markers in their own quote part without corrupting user text", () => {
    const selection = "```\ncode();\n```\n- item one\n- item two";
    const input = promptDraftToInput({
      text: "Refactor this",
      mentions: [],
      attachments: [],
      quotes: [{ id: "q1", text: selection }],
    });
    expect(input).toEqual([
      {
        type: "text",
        text: "> ```\n> code();\n> ```\n> - item one\n> - item two",
        mentions: [],
      },
      { type: "text", text: "Refactor this", mentions: [] },
    ]);
  });

  it("leaves user-text mention offsets byte-for-byte unchanged when quotes are present", () => {
    const resource: PromptMentionResource = {
      kind: "thread",
      threadId: "thr_parent",
      label: "Prompt UX thread",
    };
    const text = "Ask @manager now";
    const start = text.indexOf("@manager");
    const baseDraft = {
      text,
      mentions: [{ start, end: start + "@manager".length, resource }],
      attachments: [],
    };

    const withoutQuotes = promptDraftToInput({ ...baseDraft, quotes: [] });
    const withQuotes = promptDraftToInput({
      ...baseDraft,
      quotes: [{ id: "q1", text: "context" }],
    });

    const userPartWithout = withoutQuotes[0];
    const userPartWith = withQuotes[1];
    expect(userPartWith).toEqual(userPartWithout);
  });
});
