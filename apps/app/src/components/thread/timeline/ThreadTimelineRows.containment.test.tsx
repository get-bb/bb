// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import {
  estimateTimelineRowIntrinsicBlockSizePx,
  TOP_LEVEL_TIMELINE_ROW_CLASS_NAME,
} from "./timeline-row-containment";

afterEach(cleanup);

function rowWrapper(container: HTMLElement, rowId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-timeline-row-id="${rowId}"]`,
  );
  if (element === null) {
    throw new Error(`row ${rowId} did not render`);
  }
  return element;
}

describe("ThreadTimelineRows row containment", () => {
  it("applies content-visibility containment to top-level row wrappers only", () => {
    const rows = [
      conversationRow({
        id: "user_1",
        role: "user",
        text: "Please look into the flaky test.",
        seq: 1,
      }),
      turnRow({
        id: "turn_1",
        status: "completed",
        children: [
          commandRow({ id: "cmd_nested", command: "pnpm test", seq: 2 }),
          conversationRow({
            id: "assistant_nested",
            role: "assistant",
            text: "Nested answer.",
            seq: 3,
          }),
        ],
      }),
      conversationRow({
        id: "assistant_1",
        role: "assistant",
        text: "x".repeat(600),
        seq: 4,
      }),
    ];
    const view = render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={rows}
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
            initialExpanded={new Set(["turn_1"])}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    for (const rowId of ["user_1", "turn_1", "assistant_1"]) {
      expect(rowWrapper(view.container, rowId).className).toBe(
        TOP_LEVEL_TIMELINE_ROW_CLASS_NAME,
      );
    }
    // Nested lists (turn / bundle bodies) keep plain wrappers: their parent
    // body animates its own height.
    expect(rowWrapper(view.container, "cmd_nested").className).toBe("");
    expect(rowWrapper(view.container, "assistant_nested").className).toBe("");
    expect(rowWrapper(view.container, "assistant_nested").style.length).toBe(0);

    // Conversation rows carry a per-row intrinsic size estimate; work rows use
    // the class default (one text line).
    expect(rowWrapper(view.container, "turn_1").style.length).toBe(0);
    expect(
      rowWrapper(view.container, "assistant_1").style.containIntrinsicBlockSize,
    ).toBe(`auto ${estimateTimelineRowIntrinsicBlockSizePx(rows[2]!)}px`);
    expect(estimateTimelineRowIntrinsicBlockSizePx(rows[2]!)).toBeGreaterThan(
      estimateTimelineRowIntrinsicBlockSizePx(rows[0]!) ?? Number.NaN,
    );
    expect(TOP_LEVEL_TIMELINE_ROW_CLASS_NAME).toContain(
      "max-md:[content-visibility:auto]",
    );
  });
});
