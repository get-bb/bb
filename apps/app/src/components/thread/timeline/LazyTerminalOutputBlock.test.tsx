// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { commandRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

vi.mock("./TerminalOutputBlock.js", () => new Promise(() => undefined));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      timelineTurnSummaryDetails: vi.fn(() => new Promise(() => undefined)),
    },
  },
}));

afterEach(cleanup);

it("requests full command output while the terminal renderer is still downloading", async () => {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const row = {
    ...commandRow({
      id: "cmd_big",
      command: "pnpm test",
      output: "partial preview",
      sourceSeqStart: 4,
      sourceSeqEnd: 7,
      threadId: "thr_main",
      turnId: "turn_1",
    }),
    outputPreview: {
      experimental_fullOutputAvailability: "available" as const,
      totalChars: 9_000,
    },
  };

  render(
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

  await screen.findByRole("status", { name: "Loading output" });
  await waitFor(() => {
    expect(sdk.threads.timelineTurnSummaryDetails).toHaveBeenCalledTimes(1);
  });
  expect(
    screen.getByTestId("timeline-output-preview-note").textContent,
  ).toContain("Loading the full output");
});
