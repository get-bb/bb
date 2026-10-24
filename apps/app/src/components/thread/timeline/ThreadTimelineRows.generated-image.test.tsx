// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  GENERATED_IMAGE_SRC,
  GENERATED_IMAGE_THREAD_ID,
  generatedImageTimeline,
} from "@/test/fixtures/generated-image-turn";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

afterEach(cleanup);

describe("generated image visibility", () => {
  it.each(["live completion", "reload snapshot"] as const)(
    "shows the generated image after %s without opening work details",
    async (scenario) => {
      const { wrapper: Wrapper } = createQueryClientTestHarness();
      const timeline = (completed: boolean) => (
        <MemoryRouter>
          <Wrapper>
            <ThreadTimelineRows
              threadId={GENERATED_IMAGE_THREAD_ID}
              timelineRows={generatedImageTimeline(completed)}
              threadRuntimeDisplayStatus={completed ? "idle" : "active"}
              workspaceRootPath="/workspace"
              resolveImageViewSrc={() => GENERATED_IMAGE_SRC}
            />
          </Wrapper>
        </MemoryRouter>
      );
      const view = render(timeline(scenario === "reload snapshot"));
      if (scenario === "live completion") {
        view.rerender(timeline(true));
      }

      const preview = await screen.findByRole("button", {
        name: "Open image preview: generated.svg",
      });
      expect(within(preview).getByRole("presentation").getAttribute("src")).toBe(
        GENERATED_IMAGE_SRC,
      );
      expect(screen.queryByText("ORDINARY COMMAND OUTPUT")).toBeNull();
      expect(screen.getByText("Here is your blue circle.")).toBeTruthy();
    },
  );
});
