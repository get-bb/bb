import { describe, expect, it } from "vitest";
import type { PromptMentionResource } from "@bb/domain";
import {
  appendQuoteToDraftText,
  emptyPromptDraftState,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  promptDraftToInput,
  promptInputToDraft,
} from "./prompt-draft";

describe("prompt draft helpers", () => {
  it("drops invalid legacy raw text drafts", () => {
    const parsed = parsePromptDraftStorage("Investigate flaky login redirect");
    expect(parsed).toEqual({
      text: "",
      mentions: [],
      attachments: [],
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
      }),
    ).toBe(false);
  });

  it("maps draft text and attachments to prompt input list", () => {
    const input = promptDraftToInput({
      text: "  Ship this patch  ",
      mentions: [],
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
    });
  });
});

describe("appendQuoteToDraftText", () => {
  it("appends a one-line quote to an empty draft with a trailing newline", () => {
    const next = appendQuoteToDraftText(
      emptyPromptDraftState(),
      "  hello world  ",
    );
    expect(next.text).toBe("> hello world\n");
  });

  it("prefixes each line of a multi-line quote and prefixes blank lines as `>`", () => {
    const next = appendQuoteToDraftText(
      emptyPromptDraftState(),
      "para one\n\npara two",
    );
    expect(next.text).toBe("> para one\n>\n> para two\n");
  });

  it("appends to existing text separated by a newline", () => {
    const base = { text: "existing reply", mentions: [], attachments: [] };
    const next = appendQuoteToDraftText(base, "quoted");
    expect(next.text).toBe("existing reply\n> quoted\n");
  });

  it("ignores an empty or whitespace-only quote", () => {
    const base = emptyPromptDraftState();
    expect(appendQuoteToDraftText(base, "")).toBe(base);
    expect(appendQuoteToDraftText(base, "   \n  ")).toBe(base);
  });

  it("leaves existing mention offsets byte-for-byte unchanged (appends to the end)", () => {
    const resource: PromptMentionResource = {
      kind: "thread",
      threadId: "thr_parent",
      label: "Prompt UX thread",
    };
    const text = "Ask @manager now";
    const start = text.indexOf("@manager");
    const mention = { start, end: start + "@manager".length, resource };
    const base = { text, mentions: [mention], attachments: [] };

    const next = appendQuoteToDraftText(base, "context");

    expect(next.mentions).toEqual([mention]);
    expect(next.text.startsWith(text)).toBe(true);
  });
});
