// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  commandRow,
  fileChangeRow,
} from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

vi.mock("./TimelineFileDiffBlock.js", () => {
  throw new Error("chunk download failed");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps a failed diff download inside its file-change row", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const change = fileChangeRow({
    id: "file_1",
    stderr: "patch rejected",
    sourceSeqStart: 1,
    sourceSeqEnd: 2,
  });
  const next = commandRow({
    id: "cmd_1",
    command: "pnpm test",
    sourceSeqStart: 3,
    sourceSeqEnd: 4,
  });

  render(
    <MemoryRouter>
      <Wrapper>
        <ThreadTimelineRows
          initialExpanded={new Set([change.id, next.id])}
          threadId="thr_main"
          timelineRows={[change, next]}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </Wrapper>
    </MemoryRouter>,
  );

  expect((await screen.findByRole("alert")).textContent).toContain(
    "Could not load",
  );
  screen.getByText("patch rejected");
  screen.getByText("pnpm test");
});
