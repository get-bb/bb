// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

afterEach(cleanup);

it("opens a file an answer names by the path its collapsed work touched", () => {
  const onOpenLocalFileLink = vi.fn(() => true);
  const probeRow =
    "/home/dev/fork-work/link-probe/plugins/thread-list/app/rows/ProbeRow.tsx";
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThreadTimelineRows
          onOpenLocalFileLink={onOpenLocalFileLink}
          threadId="thr_main"
          threadRuntimeDisplayStatus="idle"
          timelineRows={[
            turnRow({
              id: "turn_with_edit",
              sourceSeqStart: 10,
              sourceSeqEnd: 20,
              threadId: "thr_main",
              experimental_touchedFilePaths: [probeRow],
            }),
            conversationRow({
              id: "answer",
              role: "assistant",
              sourceSeqStart: 21,
              text: "Created `ProbeRow.tsx`; `package.json` is unchanged.",
              threadId: "thr_main",
            }),
          ]}
          workspaceRootPath="/workspace"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    screen.getByRole("link", { name: "package.json" }).getAttribute("href"),
  ).toBe("file:///workspace/package.json");
  fireEvent.click(screen.getByRole("link", { name: "ProbeRow.tsx" }));
  expect(onOpenLocalFileLink).toHaveBeenCalledExactlyOnceWith({
    lineRange: null,
    openTargetId: null,
    path: probeRow,
  });
});
