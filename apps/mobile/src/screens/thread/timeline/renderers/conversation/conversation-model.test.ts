import { USER_MESSAGE_CHAR_CAP } from "@bb/client-core";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineUserConversationRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildAttachmentItems,
  buildAuthoredMessageBody,
  buildGeneratedMessageContent,
  classifyUserMessage,
  clipMentionTextToVisibleRange,
  GENERATED_PREVIEW_SINGLE_LINE_MAX_CHARS,
  generatedConversationIconName,
  generatedConversationTitle,
  isForkSeedAnchorRow,
  isGeneratedMessageExpandable,
  systemMessageIsTitleOnly,
} from "./conversation-model";

function mention(start: number, end: number, label = "t"): PromptTextMention {
  return {
    start,
    end,
    resource: { kind: "thread", threadId: `thread-${label}`, label },
  };
}

describe("classifyUserMessage", () => {
  it("routes agent-with-sender and system rows to the generated presentation", () => {
    expect(
      classifyUserMessage({ initiator: "agent", senderThreadId: "s1" }),
    ).toEqual({ kind: "generated", sourceKind: "agent", senderThreadId: "s1" });
    expect(
      classifyUserMessage({ initiator: "system", senderThreadId: null }),
    ).toEqual({ kind: "generated", sourceKind: "system" });
  });

  it("keeps user rows and sender-less agent rows as authored bubbles", () => {
    expect(
      classifyUserMessage({ initiator: "user", senderThreadId: null }),
    ).toEqual({ kind: "authored" });
    expect(
      classifyUserMessage({ initiator: "agent", senderThreadId: null }),
    ).toEqual({ kind: "authored" });
  });

  it("marks only the turn-less agent seed row as the fork anchor", () => {
    const base = {
      role: "user" as const,
      initiator: "agent" as const,
      senderThreadId: "s1",
    };
    expect(isForkSeedAnchorRow({ ...base, turnId: null })).toBe(true);
    expect(isForkSeedAnchorRow({ ...base, turnId: "turn-1" })).toBe(false);
  });
});

describe("clipMentionTextToVisibleRange", () => {
  it("cuts the text back to the start of a mention that straddles the visible end", () => {
    const result = clipMentionTextToVisibleRange({
      mentions: [mention(2, 6), mention(8, 14)],
      rangeStart: 0,
      text: "ab@thr cd@thre", // 14 chars; second mention would end at 14 → ok
    });
    expect(result.text).toBe("ab@thr cd@thre");
    const clipped = clipMentionTextToVisibleRange({
      mentions: [mention(9, 20)],
      rangeStart: 0,
      text: "ab@thr cd@thre",
    });
    expect(clipped.text).toBe("ab@thr cd");
    expect(clipped.mentions).toEqual([]);
  });

  it("rebases mentions onto a sliced range and drops the ones outside it", () => {
    const result = clipMentionTextToVisibleRange({
      mentions: [mention(0, 3), mention(10, 14)],
      rangeStart: 10,
      text: "@thr rest",
    });
    expect(result.mentions).toEqual([mention(0, 4)]);
  });
});

describe("buildAuthoredMessageBody", () => {
  it("splits the muted [bb …] prefix off non-user messages and rebases mentions", () => {
    const text = "[bb note] hello @thr";
    const body = buildAuthoredMessageBody({
      expanded: false,
      initiator: "agent",
      mentions: [mention(16, 20)],
      text,
    });
    expect(body.prefixText).toBe("[bb note] ");
    expect(body.content).toBe("hello @thr");
    expect(body.mentions).toEqual([mention(6, 10)]);
    expect(body.cappedByLength).toBe(false);
  });

  it("never treats a user's own [bb …] text as a prefix", () => {
    const body = buildAuthoredMessageBody({
      expanded: false,
      initiator: "user",
      mentions: [],
      text: "[bb note] hello",
    });
    expect(body.prefixText).toBeNull();
    expect(body.content).toBe("[bb note] hello");
  });

  it("caps a collapsed long body at the char cap, closing a cut code span, and restores it when expanded", () => {
    const text = `start \`code ${"x".repeat(USER_MESSAGE_CHAR_CAP)}\` end`;
    const collapsed = buildAuthoredMessageBody({
      expanded: false,
      initiator: "user",
      mentions: [],
      text,
    });
    expect(collapsed.cappedByLength).toBe(true);
    expect(collapsed.content.length).toBeLessThanOrEqual(
      USER_MESSAGE_CHAR_CAP + 1,
    );
    expect(collapsed.content.endsWith("`")).toBe(true);
    const expanded = buildAuthoredMessageBody({
      expanded: true,
      initiator: "user",
      mentions: [],
      text,
    });
    expect(expanded.content).toBe(text);
    expect(expanded.cappedByLength).toBe(true);
  });
});

describe("buildGeneratedMessageContent", () => {
  it("strips the prefix, trims, and previews the first line with mentions rebased", () => {
    const text = "[bb message from thread:abc]\n\n  Line one @thr\nLine two";
    const bodyStart = text.indexOf("Line one");
    const mentionStart = text.indexOf("@thr");
    const content = buildGeneratedMessageContent({
      initiator: "agent",
      mentions: [mention(mentionStart, mentionStart + 4)],
      text,
    });
    expect(content.messageText).toBe("Line one @thr\nLine two");
    expect(content.messageMentions).toEqual([
      mention(mentionStart - bodyStart, mentionStart - bodyStart + 4),
    ]);
    expect(content.preview).toEqual({
      content: "Line one @thr",
      mentions: [mention(9, 13)],
      parseAsMarkdown: true,
    });
    expect(content.previewTruncated).toBe(true);
  });

  it("reports a single short line as not truncated and an empty body as no preview", () => {
    expect(
      buildGeneratedMessageContent({
        initiator: "system",
        mentions: [],
        text: "[bb] done",
      }),
    ).toMatchObject({ messageText: "done", previewTruncated: false });
    expect(
      buildGeneratedMessageContent({
        initiator: "system",
        mentions: [],
        text: "[bb]   ",
      }),
    ).toMatchObject({ messageText: "", preview: null });
  });

  it("drops a preview whose only content is a mention straddling the cut", () => {
    // A lone mention longer than the cap-cut: the preview text clips back to
    // its start (empty) and must not render an empty line.
    const text = `${"y".repeat(10)}\nmore`;
    const content = buildGeneratedMessageContent({
      initiator: "agent",
      mentions: [mention(0, 12)],
      text,
    });
    expect(content.preview).toBeNull();
    expect(content.previewTruncated).toBe(true);
  });
});

describe("isGeneratedMessageExpandable", () => {
  it("opens for hidden content, truncated previews, or bodies too long for one line", () => {
    const short = "x".repeat(GENERATED_PREVIEW_SINGLE_LINE_MAX_CHARS);
    expect(
      isGeneratedMessageExpandable({
        hasExpandedOnlyContent: false,
        messageText: short,
        previewTruncated: false,
      }),
    ).toBe(false);
    expect(
      isGeneratedMessageExpandable({
        hasExpandedOnlyContent: false,
        messageText: `${short}y`,
        previewTruncated: false,
      }),
    ).toBe(true);
    expect(
      isGeneratedMessageExpandable({
        hasExpandedOnlyContent: true,
        messageText: "",
        previewTruncated: false,
      }),
    ).toBe(true);
  });
});

describe("generatedConversationTitle", () => {
  const base = {
    originKind: null,
    sourceThreadId: "s1",
    sourceIsPluginSideChat: false,
    systemMessageKind: "unlabeled" as const,
    systemMessageSubject: null,
  };

  it("uses the relationship lead-in and links the source thread", () => {
    const plain = generatedConversationTitle({
      ...base,
      sourceKind: "agent",
      sourceName: "Helper",
    });
    expect(plain.plain).toBe("Message from Helper");
    expect(plain.segments[1]).toMatchObject({
      em: true,
      link: { kind: "thread", threadId: "s1" },
    });
    expect(
      generatedConversationTitle({
        ...base,
        sourceKind: "agent",
        sourceName: "Helper",
        originKind: "fork",
      }).plain,
    ).toBe("Forked from Helper");
    const sideChat = generatedConversationTitle({
      ...base,
      sourceKind: "agent",
      sourceName: "side chat",
      sourceIsPluginSideChat: true,
    });
    expect(sideChat.plain).toBe("Replying to side chat");
    expect(sideChat.segments[1]?.link).toBeUndefined();
    expect(sideChat.action).toEqual({
      kind: "open-plugin-side-chat",
      threadId: "s1",
    });
  });

  it("renders the system taxonomy with the subject thread linked", () => {
    const title = generatedConversationTitle({
      ...base,
      sourceKind: "system",
      sourceName: "BB",
      sourceThreadId: null,
      systemMessageKind: "child-completed",
      systemMessageSubject: {
        kind: "thread",
        threadId: "child-1",
        threadName: "Child",
      },
    });
    expect(title.plain).toBe("Child finished");
    expect(title.segments[0]?.link).toEqual({
      kind: "thread",
      threadId: "child-1",
    });
    expect(
      generatedConversationTitle({
        ...base,
        sourceKind: "system",
        sourceName: "BB",
        systemMessageKind: "child-outcome-batch",
        systemMessageSubject: { kind: "thread-batch", count: 3 },
      }).plain,
    ).toBe("3 threads updated");
    // A subject shape that does not match the kind falls back.
    expect(
      generatedConversationTitle({
        ...base,
        sourceKind: "system",
        sourceName: "BB",
        systemMessageKind: "child-failed",
        systemMessageSubject: { kind: "thread-batch", count: 2 },
      }).plain,
    ).toBe("System Message");
  });

  it("picks the fork icon for fork anchors and title-only ownership rows", () => {
    expect(generatedConversationIconName("agent", "fork", "unlabeled")).toBe(
      "Fork",
    );
    expect(generatedConversationIconName("agent", null, "unlabeled")).toBe(
      "MessageSquare",
    );
    expect(
      generatedConversationIconName("system", null, "child-needs-attention"),
    ).toBe("AlertTriangle");
    expect(systemMessageIsTitleOnly("system", "ownership-assigned")).toBe(true);
    expect(systemMessageIsTitleOnly("agent", "ownership-assigned")).toBe(false);
    expect(systemMessageIsTitleOnly("system", "child-completed")).toBe(false);
  });
});

describe("buildAttachmentItems", () => {
  const attachments: TimelineUserConversationRow["attachments"] = {
    webImages: 1,
    localImages: 2,
    localFiles: 1,
    imageUrls: ["https://example.com/pic.png"],
    localImagePaths: ["uploads/a b.png", "/abs/shot.png"],
    localFilePaths: ["/abs/notes.md"],
  };

  it("resolves web, project-relative, and host-absolute images against the server", () => {
    const items = buildAttachmentItems({
      attachments,
      projectId: "p1",
      serverUrl: "http://127.0.0.1:41999/",
      threadId: "t1",
    });
    expect(items.imageItems.map((item) => item.src)).toEqual([
      "https://example.com/pic.png",
      "http://127.0.0.1:41999/api/v1/projects/p1/attachments/content?path=uploads%2Fa%20b.png",
      "http://127.0.0.1:41999/api/v1/threads/t1/host-files/content?path=%2Fabs%2Fshot.png",
    ]);
    expect(items.imageItems.map((item) => item.alt)).toEqual([
      "pic.png",
      "a b.png",
      "shot.png",
    ]);
    expect(items.filePaths).toEqual(["/abs/notes.md"]);
  });

  it("cannot resolve a relative image without a project and reports it as unloadable", () => {
    const items = buildAttachmentItems({
      attachments: { ...attachments, localImagePaths: ["uploads/x.png"] },
      projectId: null,
      serverUrl: "http://h",
      threadId: "t1",
    });
    expect(items.imageItems[1]).toMatchObject({ src: null, alt: "x.png" });
  });
});
