// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileChangeRow } from "@/test/fixtures/thread-timeline-rows";
import { LazyTimelineFileDiffBlock } from "./LazyTimelineFileDiffBlock";
import { WorkRowBody } from "./TimelineRowDetails";

const EDIT_ERROR = "Could not find the exact text in src/app.ts.";

beforeAll(() => LazyTimelineFileDiffBlock.preload());
afterEach(cleanup);

describe("file-change row body", () => {
  it("shows a failed change's error instead of the empty-diff message", () => {
    render(
      <WorkRowBody
        row={fileChangeRow({ status: "error", diff: "", stderr: EDIT_ERROR })}
        workspaceRootPath={undefined}
      />,
    );

    expect(screen.getByText(EDIT_ERROR)).toBeTruthy();
    expect(screen.queryByText("No diff available.")).toBeNull();
  });

  it("shows a failed change's error before its proposed diff", async () => {
    const view = render(
      <WorkRowBody
        row={fileChangeRow({ status: "error", stderr: EDIT_ERROR })}
        workspaceRootPath={undefined}
      />,
    );

    const error = screen.getByText(EDIT_ERROR);
    const diff = await waitFor(() => {
      const element = view.container.querySelector("[data-timeline-file-diff]");
      if (!element) throw new Error("diff not rendered");
      return element;
    });
    expect(
      error.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the empty-diff message when no error explains the missing diff", async () => {
    render(
      <WorkRowBody
        row={fileChangeRow({ status: "completed", diff: "" })}
        workspaceRootPath={undefined}
      />,
    );

    expect(await screen.findByText("No diff available.")).toBeTruthy();
  });
});
