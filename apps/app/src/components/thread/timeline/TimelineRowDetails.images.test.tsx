// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { TimelineImageGenerationWorkRow } from "@bb/server-contract";
import { imageViewRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { WorkRowBody } from "./TimelineRowDetails";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { isWorkRowExpandable } from "@bb/client-core";

const generated: TimelineImageGenerationWorkRow = {
  ...imageViewRow({
    path: "/tmp/generated.png",
    threadId: "thr_main",
    durationMs: 0,
  }),
  workKind: "image-generation",
  prompt: "Draw a circle",
  error: null,
  transparentBackground: false,
};

afterEach(cleanup);

it("expands a saved generated image and opens its preview", async () => {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <Wrapper>
        <ThreadTimelineRows
          threadId="thr_main"
          timelineRows={[generated]}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </Wrapper>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Generated image" }));
  const preview = await screen.findByRole("button", {
    name: "Open image preview: generated.png",
  });
  expect(preview.querySelector("img")?.getAttribute("src")).toBe(
    "/api/v1/threads/thr_main/host-files/content?path=%2Ftmp%2Fgenerated.png",
  );
  fireEvent.click(preview);
  expect(
    await screen.findByRole("dialog", {
      name: "Generated image: generated.png",
    }),
  ).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it.each([
  generated,
  imageViewRow({
    path: "/tmp/generated.png",
    threadId: "thr_main",
    durationMs: 0,
  }),
])(
  "preserves custom resolution and handles a missing file for $workKind",
  (row) => {
    const resolve = vi.fn(() => "/fixture-image.png");
    render(
      <WorkRowBody
        row={row}
        workspaceRootPath={undefined}
        resolveImageViewSrc={resolve}
      />,
    );
    expect(resolve).toHaveBeenCalledWith({
      path: row.path,
      threadId: row.threadId,
    });
    const image = screen
      .getByRole("button", { name: "Open image preview: generated.png" })
      .querySelector("img");
    expect(image?.getAttribute("src")).toBe("/fixture-image.png");
    if (!image) throw new Error("Expected preview image");
    fireEvent.error(image);
    expect(screen.getByText("Image preview unavailable.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Open image preview/ }),
    ).toBeNull();
  },
);

it.each([
  { status: "completed", error: null, message: "Image preview unavailable." },
  {
    status: "error",
    error: "<img src=x onerror=alert(1)>",
    message: "<img src=x onerror=alert(1)>",
  },
  { status: "interrupted", error: null, message: "Image preview unavailable." },
] as const)(
  "shows safe details for a $status generation without a saved path",
  (state) => {
    const row = { ...generated, ...state, path: null };
    expect(isWorkRowExpandable(row)).toBe(true);
    const resolve = vi.fn();
    const { container } = render(
      <WorkRowBody
        row={row}
        workspaceRootPath={undefined}
        resolveImageViewSrc={resolve}
      />,
    );
    expect(screen.getByText(state.message)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  },
);

it("waits for a path or failure before expanding a pending generation", () => {
  expect(
    isWorkRowExpandable({ ...generated, status: "pending", path: null }),
  ).toBe(false);
  expect(isWorkRowExpandable({ ...generated, status: "pending" })).toBe(true);
});
