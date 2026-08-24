import { describe, expect, it } from "vitest";
import {
  buildEditMessageRequest,
  buildMessageActionItems,
  canEditUserMessage,
  capabilitiesFromHandlers,
  type TimelineMessageActionsTarget,
} from "./message-actions-model";

function target(
  overrides: Partial<TimelineMessageActionsTarget> = {},
): TimelineMessageActionsTarget {
  return {
    rowId: "row_1",
    role: "assistant",
    text: "First paragraph.\n\nSecond paragraph.",
    sourceSeqStart: 10,
    sourceSeqEnd: 12,
    paragraph: null,
    editable: false,
    mentions: [],
    attachments: null,
    ...overrides,
  };
}

const ALL = {
  canQuote: true,
  canEdit: true,
  canFork: true,
  canSendToMain: true,
};

describe("buildMessageActionItems", () => {
  it("offers every assistant action the host supports, in action-bar order", () => {
    expect(
      buildMessageActionItems(target(), ALL).map((item) => item.key),
    ).toEqual(["copy", "add-to-chat", "fork", "send-to-main"]);
  });

  it("hides actions whose handler is absent", () => {
    expect(
      buildMessageActionItems(
        target(),
        capabilitiesFromHandlers({ forkFromMessage: () => {} }),
      ).map((item) => item.key),
    ).toEqual(["copy", "fork"]);
    expect(
      buildMessageActionItems(target(), capabilitiesFromHandlers({})).map(
        (item) => item.key,
      ),
    ).toEqual(["copy"]);
  });

  it("adds Quote paragraph only for a pressed block that is not the whole message", () => {
    expect(
      buildMessageActionItems(
        target({ paragraph: "Second paragraph." }),
        ALL,
      ).map((item) => item.key),
    ).toEqual([
      "copy",
      "quote-paragraph",
      "add-to-chat",
      "fork",
      "send-to-main",
    ]);
    expect(
      buildMessageActionItems(
        target({ text: "Only one.", paragraph: "Only one." }),
        ALL,
      ).map((item) => item.key),
    ).toEqual(["copy", "add-to-chat", "fork", "send-to-main"]);
  });

  it("offers Edit on editable user rows and keeps fork / send-to-main off them", () => {
    expect(
      buildMessageActionItems(
        target({ role: "user", editable: true }),
        ALL,
      ).map((item) => item.key),
    ).toEqual(["copy", "add-to-chat", "edit"]);
    expect(
      buildMessageActionItems(
        target({ role: "user", editable: false }),
        ALL,
      ).map((item) => item.key),
    ).toEqual(["copy", "add-to-chat"]);
  });

  it("drops Copy / Add to chat for empty bodies (attachment-only messages)", () => {
    expect(
      buildMessageActionItems(target({ text: "   " }), ALL).map(
        (item) => item.key,
      ),
    ).toEqual(["fork"]);
  });
});

describe("canEditUserMessage", () => {
  const base = {
    initiator: "user" as const,
    turnRequest: {
      kind: "message" as const,
      status: "accepted" as const,
      isGrouped: false,
    },
    attachments: null,
  };

  it("requires the person's own accepted, ungrouped message request without image urls", () => {
    expect(canEditUserMessage(base)).toBe(true);
    expect(canEditUserMessage({ ...base, initiator: "agent" })).toBe(false);
    expect(
      canEditUserMessage({
        ...base,
        turnRequest: { ...base.turnRequest, isGrouped: true },
      }),
    ).toBe(false);
    expect(
      canEditUserMessage({
        ...base,
        turnRequest: { kind: "steer", status: "pending", isGrouped: false },
      }),
    ).toBe(false);
    expect(
      canEditUserMessage({
        ...base,
        attachments: {
          webImages: 1,
          localImages: 0,
          localFiles: 0,
          imageUrls: ["https://x/y.png"],
          localImagePaths: [],
          localFilePaths: [],
        },
      }),
    ).toBe(false);
  });
});

describe("buildEditMessageRequest", () => {
  it("rebuilds the prompt input from text, mentions, and local attachments", () => {
    const mention = {
      start: 0,
      end: 5,
      resource: { kind: "thread" as const, threadId: "t", label: "T" },
    };
    const request = buildEditMessageRequest(
      target({
        role: "user",
        editable: true,
        text: "hello",
        mentions: [mention],
        attachments: {
          webImages: 0,
          localImages: 1,
          localFiles: 1,
          imageUrls: [],
          localImagePaths: ["/tmp/a.png"],
          localFilePaths: ["/tmp/notes.md"],
        },
      }),
    );
    expect(request.expectedRequestSequence).toBe(10);
    expect(request.input).toEqual([
      { type: "text", text: "hello", mentions: [mention] },
      { type: "localImage", path: "/tmp/a.png" },
      { type: "localFile", path: "/tmp/notes.md" },
    ]);
  });
});
