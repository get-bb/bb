// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import {
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { TimelineImageGallery } from "./TimelineImageGallery";

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
});

function renderTimeline(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function lightboxImage() {
  return within(screen.getByRole("dialog")).getByRole("img");
}

it("navigates the loaded page immediately without fetching older history, preserving duplicate URLs", () => {
  const history = vi.spyOn(sdk.threads, "timeline");
  renderTimeline(
    <>
      <MarkdownPreview content="![Outside](https://example.com/outside.png)" />
      <ThreadTimelineRows
        threadId="thread-1"
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
        hasOlderTimelineRows
        timelineRows={[
          conversationRow({
            id: "earlier",
            text: "![Earlier](https://example.com/a.png)",
            sourceSeqStart: 1,
          }),
          conversationRow({
            id: "recent",
            text: "![Inline](https://example.com/b.png)\n\n| Preview |\n| --- |\n| ![Table](https://example.com/a.png) |",
            sourceSeqStart: 10,
          }),
        ]}
      />
    </>,
  );
  fireEvent.click(screen.getByRole("img", { name: "Table" }));
  expect(screen.getByRole("status").textContent).toBe("3 / 3");
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(lightboxImage().getAttribute("alt")).toBe("Earlier");
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(lightboxImage().getAttribute("alt")).toBe("Inline");
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(lightboxImage().getAttribute("alt")).toBe("Earlier");
  fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
  expect(lightboxImage().getAttribute("alt")).toBe("Table");
  expect(history).not.toHaveBeenCalled();
});

it("uses rendered footnote order and excludes unused definitions", () => {
  render(
    <TimelineImageGallery>
      <MarkdownPreview
        content={
          "See note[^n].\n\n[^unused]: ![Unused](https://example.com/u.png)\n\n[^n]: ![Footnote](https://example.com/f.png)\n\n![Inline](https://example.com/i.png)"
        }
      />
    </TimelineImageGallery>,
  );
  fireEvent.click(screen.getByRole("img", { name: "Inline" }));
  expect(screen.getByRole("status").textContent).toBe("1 / 2");
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(lightboxImage().getAttribute("alt")).toBe("Footnote");
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(lightboxImage().getAttribute("alt")).toBe("Inline");
});

it("preserves occurrence identity across settled and streaming previews", () => {
  renderTimeline(
    <ThreadTimelineRows
      threadId="thread-1"
      threadRuntimeDisplayStatus="active"
      workspaceRootPath={undefined}
      timelineRows={[
        conversationRow({
          id: "streaming",
          text: "![A](https://example.com/a.png)\n\n![B](https://example.com/a.png)\nStill streaming",
        }),
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("img", { name: "B" }));
  expect(screen.getByRole("status").textContent).toBe("2 / 2");
  fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
  expect(lightboxImage().getAttribute("alt")).toBe("A");
});

it("includes lazy turn details only while expanded, including during the collapse transition", async () => {
  vi.spyOn(sdk.threads, "timelineTurnSummaryDetails").mockResolvedValue({
    rows: [
      conversationRow({
        id: "nested",
        text: "![Nested](https://example.com/n.png)",
        sourceSeqStart: 11,
      }),
    ],
    olderCursor: null,
  });
  const { container } = renderTimeline(
    <ThreadTimelineRows
      threadId="thread-1"
      threadRuntimeDisplayStatus="idle"
      workspaceRootPath={undefined}
      timelineRows={[
        turnRow({
          id: "completed-turn",
          sourceSeqStart: 10,
          sourceSeqEnd: 12,
          children: null,
        }),
        conversationRow({
          id: "final",
          text: "![Final](https://example.com/f.png)",
          sourceSeqStart: 13,
        }),
      ]}
    />,
  );
  const turn = container.querySelector(
    '[data-timeline-row-id="completed-turn"]',
  );
  const toggle = turn?.querySelector("button[aria-expanded]");
  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error("Missing turn toggle");
  }
  if (toggle.getAttribute("aria-expanded") === "true") fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("img", { name: "Final" }));
  expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
  fireEvent.click(toggle);
  fireEvent.click(await screen.findByRole("img", { name: "Nested" }));
  expect(screen.getByRole("status").textContent).toBe("1 / 2");
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(lightboxImage().getAttribute("alt")).toBe("Final");
  fireEvent.click(screen.getByRole("button", { name: "Close image preview" }));
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("img", { name: "Final" }));
  expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
  await waitFor(() =>
    expect(screen.queryByRole("img", { name: "Nested" })).toBeNull(),
  );
});

it("never includes images suppressed in ordinary worker messages", () => {
  renderTimeline(
    <ThreadTimelineRows
      threadId="thread-1"
      threadRuntimeDisplayStatus="idle"
      workspaceRootPath={undefined}
      timelineRows={[
        conversationRow({
          id: "worker-message",
          role: "user",
          initiator: "agent",
          senderThreadId: "worker",
          text: "![Suppressed](https://example.com/private.png)",
          sourceSeqStart: 1,
        }),
        conversationRow({
          id: "visible",
          text: "![Visible](https://example.com/visible.png)",
          sourceSeqStart: 2,
        }),
      ]}
    />,
  );
  expect(screen.queryByRole("img", { name: "Suppressed" })).toBeNull();
  fireEvent.click(screen.getByRole("img", { name: "Visible" }));
  expect(lightboxImage().getAttribute("alt")).toBe("Visible");
  expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
});
