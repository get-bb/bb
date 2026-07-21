// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ActiveAndIdle } from "./SplitThreadArea.stories";

afterEach(cleanup);

describe("SplitThreadArea stories", () => {
  it.each(["light", "dark"] as const)(
    "renders two populated panes and follows focus in the %s theme",
    async (theme) => {
      const view = render(
        <div className={theme}>
          <MemoryRouter>
            <TooltipProvider>
              <ActiveAndIdle />
            </TooltipProvider>
          </MemoryRouter>
        </div>,
      );

      const panes = view.container.querySelectorAll("[data-split-pane-id]");
      expect(panes).toHaveLength(2);
      const idlePane = panes[0];
      const activePane = panes[1];
      if (
        !(idlePane instanceof HTMLElement) ||
        !(activePane instanceof HTMLElement)
      ) {
        throw new Error("Expected two split pane elements");
      }

      expect(idlePane.querySelector("header")?.classList).toContain(
        "opacity-50",
      );
      expect(activePane.querySelector("header")?.classList).not.toContain(
        "opacity-50",
      );
      expect(view.getByText("Fix Thread Drag Sync")).toBeTruthy();
      expect(view.getByText("Refine split styling")).toBeTruthy();
      expect(
        view.getByText(
          "When I drag threads between sections, the source row sometimes stays faded after the drop.",
        ),
      ).toBeTruthy();
      expect(
        view.getByText(
          "Make the divider thinner, keep the inactive timeline readable, and let the header carry focus.",
        ),
      ).toBeTruthy();

      const idleComposer = idlePane.querySelector<HTMLElement>(
        '[data-split-composer-state="inactive"]',
      );
      const activeComposer = activePane.querySelector<HTMLElement>(
        '[data-split-composer-state="active"]',
      );
      if (!idleComposer || !activeComposer) {
        throw new Error("Expected focus-aware composers in both split panes");
      }
      expect(idleComposer.classList).toContain("opacity-50");
      expect(idleComposer.hasAttribute("aria-disabled")).toBe(false);
      expect(idleComposer.classList).not.toContain("pointer-events-none");
      expect(activeComposer.classList).not.toContain("opacity-50");
      const inactiveTimelineOverlay = idlePane.querySelector<HTMLElement>(
        "[data-inactive-split-timeline-overlay]",
      );
      expect(inactiveTimelineOverlay).toBeTruthy();
      expect(
        inactiveTimelineOverlay?.closest("[data-scroll-surface-overlay]")
          ?.classList,
      ).toContain("pointer-events-none");
      expect(
        activePane.querySelector("[data-inactive-split-timeline-overlay]"),
      ).toBeNull();

      fireEvent.pointerDown(idleComposer, { button: 0 });

      await waitFor(() => {
        const nextActiveComposer = idlePane.querySelector<HTMLElement>(
          '[data-split-composer-state="active"]',
        );
        const nextInactiveComposer = activePane.querySelector<HTMLElement>(
          '[data-split-composer-state="inactive"]',
        );
        expect(nextActiveComposer?.classList).not.toContain("opacity-50");
        expect(nextInactiveComposer?.classList).toContain("opacity-50");
        expect(
          idlePane.querySelector("[data-inactive-split-timeline-overlay]"),
        ).toBeNull();
        expect(
          activePane.querySelector("[data-inactive-split-timeline-overlay]"),
        ).toBeTruthy();
      });
    },
  );
});
