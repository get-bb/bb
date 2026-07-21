// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ActiveAndIdle } from "./SplitThreadArea.stories";

afterEach(cleanup);

describe("SplitThreadArea stories", () => {
  it("renders the active and idle story as two real split panes", () => {
    const view = render(
      <MemoryRouter>
        <TooltipProvider>
          <ActiveAndIdle />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(
      view.container.querySelectorAll("[data-split-pane-id]"),
    ).toHaveLength(2);
    expect(view.getByText("Fix Thread Drag Sync")).toBeTruthy();
    expect(view.getByText("Refine split styling")).toBeTruthy();
  });
});
