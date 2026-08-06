// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

// Bypass lazy imports from @pierre/diffs in test.
vi.mock("@/components/diff/LazyWorkerPoolProvider", () => ({
  LazyWorkerPoolProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
}));

// Bypass the lazy() wrapper for ThreadDetailWorkerPoolProvider.
vi.mock("./ThreadDetailWorkerPoolProvider", () => ({
  ThreadDetailWorkerPoolProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
}));

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

      // Wait for lazy-loaded providers to resolve.
      await waitFor(() => {
        const panes = view.container.querySelectorAll("[data-split-pane-id]");
        expect(panes).toHaveLength(2);
      });
      const panes = view.container.querySelectorAll("[data-split-pane-id]");
      const idlePane = panes[0];
      const activePane = panes[1];
      if (
        !(idlePane instanceof HTMLElement) ||
        !(activePane instanceof HTMLElement)
      ) {
        throw new Error("Expected two split pane elements");
      }

      expect(idlePane.querySelector("header")?.classList).not.toContain(
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
      expect(idlePane.querySelector('[aria-label="Goal"]')).toBeTruthy();
      expect(activePane.querySelector('[aria-label="Goal"]')).toBeTruthy();

      const idleComposer = idlePane.querySelector<HTMLElement>(
        '[data-app-composer=""]',
      );
      const activeComposer = activePane.querySelector<HTMLElement>(
        '[data-app-composer=""]',
      );
      if (!idleComposer || !activeComposer) {
        throw new Error("Expected focus-aware composers in both split panes");
      }
      expect(idleComposer.classList).not.toContain("opacity-50");
      expect(idleComposer.hasAttribute("aria-disabled")).toBe(false);
      expect(idleComposer.classList).not.toContain("pointer-events-none");
      expect(activeComposer.classList).not.toContain("opacity-50");
      expect(idlePane.querySelector("[data-thread-window]")).toBeTruthy();
      expect(activePane.querySelector("[data-thread-window]")).toBeTruthy();
      const idleScrim = idlePane.querySelector<HTMLElement>(
        ':scope > [data-pane-focus-scrim=""]',
      );
      const activeScrim = activePane.querySelector<HTMLElement>(
        ':scope > [data-pane-focus-scrim=""]',
      );
      expect(idleScrim?.classList).toContain("pointer-events-none");
      expect(idleScrim?.classList).toContain("bg-background/30");
      expect(idleScrim?.classList).not.toContain("bg-background/20");
      expect(idleScrim?.classList).not.toContain("bg-background/40");
      expect(activeScrim?.classList).toContain("bg-transparent");

      fireEvent.pointerDown(idleComposer, { button: 0 });

      await waitFor(() => {
        const nextActiveComposer = idlePane.querySelector<HTMLElement>(
          '[data-app-composer=""]',
        );
        const nextInactiveComposer = activePane.querySelector<HTMLElement>(
          '[data-app-composer=""]',
        );
        expect(nextActiveComposer?.classList).not.toContain("opacity-50");
        expect(nextInactiveComposer?.classList).not.toContain("opacity-50");
        expect(idleScrim?.classList).toContain("bg-transparent");
        expect(activeScrim?.classList).toContain("bg-background/30");
      });
    },
  );
});
