// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ComponentProps, type ReactElement } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@/components/ui/hooks/use-pointer-coarse";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

// ThreadTimelineRows reads route state for the search deep-link scroll, so it
// must render inside a Router. Production and Ladle always provide one; these
// isolated unit renders wrap the tree in a MemoryRouter.
const toMarkup = (ui: ReactElement) =>
  renderToStaticMarkup(<MemoryRouter>{ui}</MemoryRouter>);
const renderWithRouter = (
  ui: ReactElement,
  initialEntries: ComponentProps<typeof MemoryRouter>["initialEntries"] = ["/"],
) => render(<MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>);

function SameThreadSearchNavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          navigate("/thread", {
            state: { searchMessageSeq: 12, searchThreadId: "thr_main" },
          })
        }
      >
        Open search match
      </button>
      <ThreadTimelineRows
        initialExpanded={new Set(["turn_with_match"])}
        threadId="thr_main"
        timelineRows={[
          turnRow({
            id: "turn_with_match",
            sourceSeqStart: 10,
            sourceSeqEnd: 20,
            children: [
              conversationRow({
                id: "nested_match",
                role: "assistant",
                text: "Nested answer containing the search result.",
                sourceSeqStart: 12,
                sourceSeqEnd: 12,
                threadId: "thr_main",
              }),
            ],
            threadId: "thr_main",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />
    </>
  );
}

function SearchOlderRowsHarness({
  onLoadOlderRows,
}: {
  onLoadOlderRows: () => void;
}) {
  const [loadedOlderRows, setLoadedOlderRows] = useState(false);
  const rows = loadedOlderRows
    ? [
        conversationRow({
          id: "older_match",
          role: "assistant",
          text: "Older answer containing the search result.",
          sourceSeqStart: 12,
          sourceSeqEnd: 12,
          threadId: "thr_main",
        }),
        conversationRow({
          id: "latest_message",
          role: "assistant",
          text: "Latest answer.",
          sourceSeqStart: 30,
          sourceSeqEnd: 30,
          threadId: "thr_main",
        }),
      ]
    : [
        conversationRow({
          id: "latest_message",
          role: "assistant",
          text: "Latest answer.",
          sourceSeqStart: 30,
          sourceSeqEnd: 30,
          threadId: "thr_main",
        }),
      ];

  return (
    <ThreadTimelineRows
      threadId="thr_main"
      timelineRows={rows}
      hasOlderTimelineRows={!loadedOlderRows}
      isLoadingOlderTimelineRows={false}
      onLoadOlderRows={() => {
        onLoadOlderRows();
        setLoadedOlderRows(true);
      }}
      threadRuntimeDisplayStatus="idle"
      workspaceRootPath={undefined}
    />
  );
}

function SearchOlderRowsFailedLoadHarness({
  onLoadOlderRows,
}: {
  onLoadOlderRows: () => void;
}) {
  const [isLoadingOlderRows, setIsLoadingOlderRows] = useState(false);

  return (
    <>
      <span data-testid="older-load-state">
        {isLoadingOlderRows ? "loading" : "idle"}
      </span>
      <ThreadTimelineRows
        threadId="thr_main"
        timelineRows={[
          conversationRow({
            id: "latest_message",
            role: "assistant",
            text: "Latest answer.",
            sourceSeqStart: 30,
            sourceSeqEnd: 30,
            threadId: "thr_main",
          }),
        ]}
        hasOlderTimelineRows
        isLoadingOlderTimelineRows={isLoadingOlderRows}
        onLoadOlderRows={() => {
          onLoadOlderRows();
          setIsLoadingOlderRows(true);
          return Promise.resolve().then(() => {
            setIsLoadingOlderRows(false);
            throw new Error("Older page failed");
          });
        }}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />
    </>
  );
}

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

function mockSelectionMenuMedia({
  isCompactViewport = false,
  isPointerCoarse = false,
}: {
  isCompactViewport?: boolean;
  isPointerCoarse?: boolean;
} = {}) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches:
      (query === COMPACT_VIEWPORT_QUERY && isCompactViewport) ||
      (query === POINTER_COARSE_QUERY && isPointerCoarse),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ThreadTimelineRows actions", () => {
  it("renders send-to-main on assistant rows when the timeline supplies a handler", () => {
    const markup = toMarkup(
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

  it("hides assistant message actions inside completed turn summaries", () => {
    const markup = toMarkup(
      <ThreadTimelineRows
        initialExpanded={new Set(["turn_completed"])}
        timelineRows={[
          turnRow({
            id: "turn_completed",
            status: "completed",
            durationMs: 1_000,
            children: [
              conversationRow({
                id: "agent_completed",
                role: "assistant",
                text: "Archived assistant response.",
              }),
            ],
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />,
    );

    expect(markup).toContain("Worked for");
    expect(markup).toContain("Archived assistant response.");
    expect(markup).not.toContain('aria-label="Copy message"');
  });

  it("keeps assistant message actions visible inside pending turn rows", () => {
    const markup = toMarkup(
      <ThreadTimelineRows
        initialExpanded={new Set(["turn_pending"])}
        timelineRows={[
          turnRow({
            id: "turn_pending",
            status: "pending",
            durationMs: null,
            children: [
              conversationRow({
                id: "agent_pending",
                role: "assistant",
                text: "Streaming assistant response.",
              }),
            ],
          }),
        ]}
        threadRuntimeDisplayStatus="active"
        workspaceRootPath={undefined}
      />,
    );

    expect(markup).toContain("Working");
    expect(markup).toContain("Streaming assistant response.");
    expect(markup).toContain('aria-label="Copy message"');
  });

  it("passes regular user message text to add-to-chat", () => {
    const onSelectionAddToChat = vi.fn();
    renderWithRouter(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "user",
            text: "  Quote this user prompt.  ",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSelectionAddToChat={onSelectionAddToChat}
        workspaceRootPath={undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    expect(onSelectionAddToChat).toHaveBeenCalledWith(
      "Quote this user prompt.",
    );
  });

  it("passes user message attachments to add-to-chat", () => {
    const onSelectionAddToChat = vi.fn();
    renderWithRouter(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "user",
            text: "  Quote this user prompt.  ",
            attachments: {
              webImages: 1,
              localImages: 1,
              localFiles: 1,
              imageUrls: ["https://example.com/remote.png"],
              localImagePaths: ["uploads/screenshot.png"],
              localFilePaths: ["uploads/spec.md"],
            },
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSelectionAddToChat={onSelectionAddToChat}
        workspaceRootPath={undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    expect(onSelectionAddToChat).toHaveBeenCalledWith(
      "Quote this user prompt.",
      [
        {
          type: "localImage",
          path: "uploads/screenshot.png",
          name: "screenshot.png",
          sizeBytes: 0,
        },
        {
          type: "localFile",
          path: "uploads/spec.md",
          name: "spec.md",
          sizeBytes: 0,
        },
      ],
    );
  });

  it("shows add-to-chat for attachment-only user messages", () => {
    const onSelectionAddToChat = vi.fn();
    renderWithRouter(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "user",
            text: "",
            attachments: {
              webImages: 0,
              localImages: 0,
              localFiles: 1,
              imageUrls: [],
              localImagePaths: [],
              localFilePaths: ["uploads/spec.md"],
            },
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSelectionAddToChat={onSelectionAddToChat}
        workspaceRootPath={undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    expect(onSelectionAddToChat).toHaveBeenCalledWith("", [
      {
        type: "localFile",
        path: "uploads/spec.md",
        name: "spec.md",
        sizeBytes: 0,
      },
    ]);
  });

  it("hides user message add-to-chat when no add handler is supplied", () => {
    const markup = toMarkup(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "user",
            text: "No add-to-chat handler here.",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />,
    );

    expect(markup).toContain('aria-label="Copy message"');
    expect(markup).not.toContain('aria-label="Add to chat"');
  });

  it("passes the selected assistant row branch point to side-chat replies", async () => {
    const onSelectionReplyInSideChat = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderWithRouter(
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
    expect(screen.queryByRole("button", { name: "Add to chat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reply in side chat" }));

    expect(onSelectionReplyInSideChat).toHaveBeenCalledWith({
      messageText: "this earlier answer",
      sourceSeqEnd: 42,
    });
  });

  it("does not show the floating selection menu on coarse pointers", async () => {
    mockSelectionMenuMedia({ isPointerCoarse: true });
    const onSelectionAddToChat = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderWithRouter(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "assistant",
            text: "Mobile selection should use native controls.",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSelectionAddToChat={onSelectionAddToChat}
        workspaceRootPath={undefined}
      />,
    );
    const textNode = screen.getByText(
      "Mobile selection should use native controls.",
    ).firstChild;
    expect(textNode).not.toBeNull();
    mockWindowSelection({
      node: textNode!,
      text: "native controls",
    });

    await act(async () => {
      fireEvent(document, new Event("selectionchange"));
    });

    expect(screen.queryByRole("button", { name: "Add to chat" })).toBeNull();
    expect(onSelectionAddToChat).not.toHaveBeenCalled();
  });

  it("keeps the floating selection menu on compact fine-pointer viewports", async () => {
    mockSelectionMenuMedia({ isCompactViewport: true });
    const onSelectionAddToChat = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderWithRouter(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "assistant",
            text: "Compact fine pointer keeps the floating selection menu.",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSelectionAddToChat={onSelectionAddToChat}
        workspaceRootPath={undefined}
      />,
    );
    const textNode = screen.getByText(
      "Compact fine pointer keeps the floating selection menu.",
    ).firstChild;
    expect(textNode).not.toBeNull();
    mockWindowSelection({
      node: textNode!,
      text: "floating selection menu",
    });

    fireEvent(document, new Event("selectionchange"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy(),
    );
  });

  it("ignores sidebar search scroll state for a different thread", () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");

    renderWithRouter(
      <ThreadTimelineRows
        threadId="thr_side_chat"
        timelineRows={[
          conversationRow({
            id: "side_chat_message",
            role: "assistant",
            text: "Side chat answer.",
            sourceSeqStart: 12,
            sourceSeqEnd: 12,
            threadId: "thr_side_chat",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />,
      [
        {
          pathname: "/thread",
          state: { searchMessageSeq: 12, searchThreadId: "thr_main" },
        },
      ],
    );

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("scrolls sidebar search matches to the nested row instead of the containing parent", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    const { container } = renderWithRouter(
      <ThreadTimelineRows
        threadId="thr_main"
        timelineRows={[
          turnRow({
            id: "turn_with_match",
            sourceSeqStart: 10,
            sourceSeqEnd: 20,
            children: [
              conversationRow({
                id: "nested_match",
                role: "assistant",
                text: "Nested answer containing the search result.",
                sourceSeqStart: 12,
                sourceSeqEnd: 12,
                threadId: "thr_main",
              }),
            ],
            threadId: "thr_main",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />,
      [
        {
          pathname: "/thread",
          state: { searchMessageSeq: 12, searchThreadId: "thr_main" },
        },
      ],
    );

    const parentRow = container.querySelector(
      '[data-timeline-row-id="turn_with_match"]',
    );
    const nestedRow = await waitFor(() => {
      const row = container.querySelector(
        '[data-timeline-row-id="nested_match"]',
      );
      if (row === null) {
        throw new Error("Nested search row was not rendered");
      }
      return row;
    });

    await waitFor(() =>
      expect(nestedRow.classList.contains("bb-search-flash")).toBe(true),
    );
    expect(parentRow?.classList.contains("bb-search-flash")).toBe(false);
  });

  it("loads older timeline rows before scrolling to an older sidebar search match", async () => {
    const onLoadOlderRows = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    const { container } = renderWithRouter(
      <SearchOlderRowsHarness onLoadOlderRows={onLoadOlderRows} />,
      [
        {
          pathname: "/thread",
          state: { searchMessageSeq: 12, searchThreadId: "thr_main" },
        },
      ],
    );

    await waitFor(() => expect(onLoadOlderRows).toHaveBeenCalledTimes(1));
    const olderRow = await waitFor(() => {
      const row = container.querySelector('[data-timeline-row-id="older_match"]');
      if (row === null) {
        throw new Error("Older search row was not rendered");
      }
      return row;
    });

    await waitFor(() =>
      expect(olderRow.classList.contains("bb-search-flash")).toBe(true),
    );
  });

  it("does not retry failed older-row auto-loading until rows advance", async () => {
    const onLoadOlderRows = vi.fn();

    renderWithRouter(
      <SearchOlderRowsFailedLoadHarness onLoadOlderRows={onLoadOlderRows} />,
      [
        {
          pathname: "/thread",
          state: { searchMessageSeq: 12, searchThreadId: "thr_main" },
        },
      ],
    );

    await waitFor(() => expect(onLoadOlderRows).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("older-load-state").textContent).toBe("idle"),
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onLoadOlderRows).toHaveBeenCalledTimes(1);
  });

  it("forces a manually collapsed same-thread search ancestor open", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    const { container } = renderWithRouter(
      <SameThreadSearchNavigationHarness />,
      ["/thread"],
    );

    expect(
      container.querySelector('[data-timeline-row-id="nested_match"]'),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { expanded: true }));
    await waitFor(() =>
      expect(
        container.querySelector('[data-timeline-row-id="nested_match"]'),
      ).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open search match" }));
    const nestedRow = await waitFor(() => {
      const row = container.querySelector(
        '[data-timeline-row-id="nested_match"]',
      );
      if (row === null) {
        throw new Error("Nested search row was not rendered");
      }
      return row;
    });

    await waitFor(() =>
      expect(nestedRow.classList.contains("bb-search-flash")).toBe(true),
    );
  });
});
