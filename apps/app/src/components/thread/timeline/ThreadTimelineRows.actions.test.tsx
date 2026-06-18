// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

function mockWindowSelection({ node, text }: { node: Node; text: string }) {
  const rect = new DOMRect(10, 20, 30, 8);
  const range = {
    commonAncestorContainer: node,
    getBoundingClientRect: () => rect,
    getClientRects: () => ({
      length: 1,
      item: (index: number) => (index === 0 ? rect : null),
    }),
  } as unknown as Range;
  vi.spyOn(window, "getSelection").mockReturnValue({
    anchorNode: node,
    focusNode: node,
    getRangeAt: () => range,
    isCollapsed: false,
    rangeCount: 1,
    removeAllRanges: vi.fn(),
    toString: () => text,
  } as unknown as Selection);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadTimelineRows actions", () => {
  it("renders send-to-main on assistant rows when the timeline supplies a handler", () => {
    const markup = renderToStaticMarkup(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "assistant",
            text: "Use this answer in the main chat.",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSendToMainMessage={() => undefined}
        workspaceRootPath={undefined}
      />,
    );

    expect(markup).toContain('aria-label="Send to main thread"');
  });

  it("passes the selected assistant row branch point to side-chat replies", async () => {
    const onSelectionReplyInSideChat = vi.fn();
    render(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "assistant",
            text: "Select this earlier answer.",
            sourceSeqEnd: 42,
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSelectionReplyInSideChat={onSelectionReplyInSideChat}
        workspaceRootPath={undefined}
      />,
    );
    const textNode = screen.getByText("Select this earlier answer.").firstChild;
    expect(textNode).not.toBeNull();
    mockWindowSelection({
      node: textNode!,
      text: "this earlier answer",
    });

    fireEvent(document, new Event("selectionchange"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reply in side chat" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reply in side chat" }));

    expect(onSelectionReplyInSideChat).toHaveBeenCalledWith({
      messageText: "this earlier answer",
      sourceSeqEnd: 42,
    });
  });
});
