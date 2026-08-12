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

      expect(idlePane.querySelector("header")?.classList).not.toContain(
        "opacity-50",
      );
      expect(activePane.querySelector("header")?.classList).not.toContain(
        "opacity-50",
      );
      expect(view.getByText("Fix Thread Drag Sync")).toBeTruthy();
      const titlePill = activePane.querySelector(
        'header [data-prompt-mention="true"]',
      );
      expect(titlePill).toBeTruthy();
      expect(titlePill?.tagName).not.toBe("A");
      expect(titlePill?.textContent).toBe("Raw thread ID mention target");

      const linkedMessagePills = activePane.querySelectorAll(
        'a[data-prompt-mention="true"]',
      );
      expect(linkedMessagePills).toHaveLength(3);
      for (const linkedMessagePill of linkedMessagePills) {
        expect(linkedMessagePill.textContent).toBe(
          "Raw thread ID mention target",
        );
        expect(linkedMessagePill.getAttribute("href")).toBe(
          "/projects/proj_bb/threads/thr_dcwivn5n8w",
        );
      }
      expect(
        Array.from(activePane.querySelectorAll("code")).find(
          (node) => node.textContent === "thr_dcwivn5n8w",
        ),
      ).toBeUndefined();
      expect(
        view.getByText(
          "When I drag threads between sections, the source row sometimes stays faded after the drop.",
        ),
      ).toBeTruthy();
      expect(activePane.textContent).toContain("Use ");
      expect(activePane.textContent).toContain(
        " as context, make the divider thinner, and let the header carry focus.",
      );
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
