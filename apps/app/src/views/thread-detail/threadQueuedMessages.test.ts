import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import {
  formatQueuedMessagePreview,
  queuedInputToDraft,
} from "./threadQueuedMessages";

describe("threadQueuedMessages", () => {
  it("formats queued-message previews from text or attachment-only inputs", () => {
    const input: PromptInput[] = [
      { type: "text", text: "  First line  ", mentions: [] },
      { type: "text", text: "Second line", mentions: [] },
    ];

    expect(formatQueuedMessagePreview(input)).toBe("First line Second line");
    expect(
      formatQueuedMessagePreview([
        {
          type: "localFile",
          path: "/tmp/notes.md",
          name: "notes.md",
          sizeBytes: 10,
        },
      ]),
    ).toBe("Attachment only (notes.md)");
    expect(
      formatQueuedMessagePreview([
        {
          type: "localImage",
          path: "  ",
        },
      ]),
    ).toBe("Attachment only (Attachment)");
  });

  it("omits agent-only side-chat reply references from queued previews", () => {
    expect(
      formatQueuedMessagePreview([
        {
          type: "text",
          text: "Replying to this earlier message in the conversation:\n\nEarlier agent reply",
          mentions: [],
          visibility: "agent-only",
        },
        { type: "text", text: "What should I do next?", mentions: [] },
      ]),
    ).toBe("What should I do next?");
  });

  it("restores editable drafts from queued messages", () => {
    const draft = queuedInputToDraft([
      { type: "text", text: "Follow up", mentions: [] },
      {
        type: "localImage",
        path: "/tmp/image.png",
      },
    ]);
    const attachmentOnlyDraft = queuedInputToDraft([
      {
        type: "localImage",
        path: "  ",
      },
    ]);

    expect(draft).toEqual({
      text: "Follow up",
      mentions: [],
      attachments: [
        {
          type: "localImage",
          path: "/tmp/image.png",
          name: "image.png",
          sizeBytes: 0,
        },
      ],
    });
    expect(attachmentOnlyDraft.attachments[0]?.name).toBe("Attachment");
  });

  it("omits agent-only queued-message content when restoring a draft", () => {
    const draft = queuedInputToDraft([
      {
        type: "text",
        text: "Replying to this earlier message in the conversation:\n\nEarlier agent reply",
        mentions: [],
        visibility: "agent-only",
      },
      {
        type: "localFile",
        path: "/tmp/hidden.md",
        name: "hidden.md",
        visibility: "agent-only",
      },
      { type: "text", text: "What should I do next?", mentions: [] },
      {
        type: "localFile",
        path: "/tmp/visible.md",
        name: "visible.md",
        sizeBytes: 12,
      },
    ]);

    expect(draft).toEqual({
      text: "What should I do next?",
      mentions: [],
      attachments: [
        {
          type: "localFile",
          path: "/tmp/visible.md",
          name: "visible.md",
          sizeBytes: 12,
        },
      ],
    });
  });
});
