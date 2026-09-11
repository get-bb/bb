// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  TimelineConversationRow,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { InlineImageMessageContext } from "@/components/ui/inline-image-gallery-context";
import { TimelineImageGallery } from "./TimelineImageGallery";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return { ...actual, sdk: { threads: { timeline: vi.fn() } } };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function row(
  id: string,
  sequence: number,
  text: string,
): TimelineConversationRow {
  return {
    id,
    kind: "conversation",
    role: "assistant",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: sequence,
    sourceSeqEnd: sequence,
    startedAt: 1,
    createdAt: 1,
    text,
    attachments: null,
    turnRequest: null,
  };
}
const earlier = row("earlier", 1, "![Earlier](https://example.com/a.png)");
const recent = row(
  "recent",
  10,
  "![Inline](https://example.com/b.png)\n\n| Preview |\n| --- |\n| ![Table](https://example.com/a.png) |",
);

function Preview() {
  return (
    <TimelineImageGallery
      timelineRows={[recent]}
      threadId="thread-1"
      workspaceRootPath={undefined}
      hasOlderTimelineRows
    >
      <InlineImageMessageContext.Provider value={recent.id}>
        <MarkdownPreview content={recent.text} />
      </InlineImageMessageContext.Provider>
    </TimelineImageGallery>
  );
}

it("navigates from a table through earlier history in chronological order, preserving duplicate URLs", async () => {
  vi.mocked(sdk.threads.timeline)
    .mockResolvedValueOnce(
      makeThreadTimelineResponse({
        rows: [recent],
        timelinePage: {
          olderCursor: { anchorId: "older", anchorSeq: 10 },
          hasOlderRows: true,
        },
      }),
    )
    .mockResolvedValueOnce(makeThreadTimelineResponse({ rows: [earlier] }));
  render(<Preview />);
  fireEvent.click(screen.getByRole("img", { name: "Table" }));
  const dialog = screen.getByRole("dialog", { name: "Timeline image preview" });
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("3 / 3"),
  );
  expect(sdk.threads.timeline).toHaveBeenLastCalledWith(
    expect.objectContaining({ beforeAnchorId: "older", beforeAnchorSeq: "10" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("Earlier");
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("Inline");
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("Earlier");
  fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
  expect(within(dialog).getByRole("img").getAttribute("alt")).toBe("Table");
});

it("cancels pending history on dismissal without reopening the lightbox", async () => {
  let resolvePage: (page: ThreadTimelineResponse) => void = () => {};
  vi.mocked(sdk.threads.timeline).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePage = resolve;
      }),
  );
  render(<Preview />);
  fireEvent.click(screen.getByRole("img", { name: "Table" }));
  expect(
    screen.getByRole("button", { name: "Next image" }).hasAttribute("disabled"),
  ).toBe(true);
  const signal = vi.mocked(sdk.threads.timeline).mock.calls[0][0].signal;
  fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    resolvePage(makeThreadTimelineResponse({ rows: [earlier, recent] })),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps dismissal and loaded-image navigation available when history fails", async () => {
  vi.mocked(sdk.threads.timeline).mockRejectedValueOnce(new Error("offline"));
  render(<Preview />);
  fireEvent.click(screen.getByRole("img", { name: "Table" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Earlier images unavailable",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
  expect(
    within(screen.getByRole("dialog")).getByRole("img").getAttribute("alt"),
  ).toBe("Inline");
  fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
