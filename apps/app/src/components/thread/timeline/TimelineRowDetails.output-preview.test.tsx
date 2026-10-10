// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineCommandWorkRow } from "@bb/server-contract";
import { commandRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { timelineTurnSummaryDetails: vi.fn() } },
}));

const timelineTurnSummaryDetails = vi.mocked(
  sdk.threads.timelineTurnSummaryDetails,
);

const FULL_OUTPUT = `FULL-HEAD ${"x".repeat(5_000)} FULL-TAIL`;
const PREVIEW_OUTPUT =
  "FULL-HEAD xxx\n…[4,000 characters omitted from preview]\nxxx FULL-TAIL";

function previewedCommandRow(
  overrides: Partial<Pick<TimelineCommandWorkRow, "status">> = {},
): TimelineCommandWorkRow {
  return {
    ...commandRow({
      id: "cmd_big",
      command: "pnpm test",
      output: PREVIEW_OUTPUT,
      sourceSeqStart: 4,
      sourceSeqEnd: 7,
      threadId: "thr_main",
      turnId: "turn_1",
      status: overrides.status ?? "completed",
      exitCode: overrides.status === "pending" ? null : 0,
    }),
    outputPreview: {
      experimental_fullOutputAvailability: "available",
      totalChars: FULL_OUTPUT.length,
    },
  };
}

function renderExpandedRow(row: TimelineCommandWorkRow) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <Wrapper>
        <ThreadTimelineRows
          initialExpanded={new Set([row.id])}
          threadId="thr_main"
          timelineRows={[row]}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </Wrapper>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  timelineTurnSummaryDetails.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("previewed command output", () => {
  it("shows the preview with a retry when the full-output load fails", async () => {
    timelineTurnSummaryDetails.mockRejectedValue(new Error("boom"));
    const view = renderExpandedRow(previewedCommandRow());

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
    await waitFor(() => {
      expect(view.container.textContent).toContain("characters omitted");
    });
    expect(
      screen.getByTestId("timeline-output-preview-note").textContent,
    ).toContain("Failed to load the full output");
  });
});
