// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useContext, useLayoutEffect, useRef } from "react";
import { RootComposeCompactHome } from "./RootComposeCompactHome";
import { ComposerMaxHeightContext } from "@/components/promptbox/composer-max-height";
import { registerPaneComposerFocus } from "@/lib/pane-composer-focus";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ComposerRootProbe() {
  const rootRef = useRef<HTMLDivElement>(null);
  const maxHeight = useContext(ComposerMaxHeightContext);
  useLayoutEffect(
    () => registerPaneComposerFocus(rootRef.current!, () => false),
    [],
  );
  return (
    <div
      ref={rootRef}
      data-testid="composer-root"
      data-max-height={maxHeight}
    />
  );
}

function renderCompactHome() {
  return render(
    <RootComposeCompactHome composer={<div data-testid="composer" />}>
      <div data-testid="recents" />
    </RootComposeCompactHome>,
  );
}

describe("RootComposeCompactHome", () => {
  it("keeps the composer above a scroll viewport that runs behind it", () => {
    renderCompactHome();

    const viewport = screen.getByTestId("root-compose-compact-scroll-viewport");
    const composer = screen.getByTestId("root-compose-compact-composer");

    expect(viewport.className).toContain("bottom-0");
    expect(viewport.className).toContain("overflow-y-auto");
    expect(composer.className).toContain("absolute");
    expect(composer.className).toContain("bottom-0");
    expect(composer.className).toContain("z-10");
    expect(composer.contains(screen.getByTestId("composer"))).toBe(true);
    expect(viewport.contains(screen.getByTestId("recents"))).toBe(true);
  });

  it("writes measured geometry directly before the compact home paints", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "root-compose-compact-home") return 852;
        if (this.dataset.testid === "root-compose-compact-composer") {
          return 188;
        }
        return 0;
      },
    );

    renderCompactHome();

    const leadingSpacer = screen.getByTestId(
      "root-compose-compact-leading-spacer",
    );
    const bottomSpacer = screen.getByTestId(
      "root-compose-compact-bottom-spacer",
    );
    expect(leadingSpacer.style.height).toBe("314px");
    expect(bottomSpacer.style.height).toBe("188px");
  });

  it("caps the composer so a tall draft keeps it below the app chrome row", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === "root-compose-compact-home") return 480;
        if (this.dataset.testid === "root-compose-compact-composer") {
          return 682;
        }
        if (this.dataset.testid === "composer-root") return 600;
        return 0;
      },
    );

    render(
      <RootComposeCompactHome composer={<ComposerRootProbe />}>
        <div />
      </RootComposeCompactHome>,
    );

    expect(screen.getByTestId("composer-root").dataset.maxHeight).toBe(
      `${480 - 56 - (682 - 600)}`,
    );
  });

  it("starts the scroll viewport at the app chrome row so rows scroll up through the band", () => {
    renderCompactHome();

    const viewport = screen.getByTestId("root-compose-compact-scroll-viewport");
    const content = screen.getByTestId("root-compose-compact-scroll-content");
    expect(viewport.style.top).toBe("56px");
    expect(content.firstElementChild).toBe(
      screen.getByTestId("root-compose-compact-leading-spacer"),
    );
  });

  it("rests a list that fits on the composer instead of the band top", () => {
    renderCompactHome();

    const content = screen.getByTestId("root-compose-compact-scroll-content");
    expect(content.className).toContain("min-h-full");
    expect(content.className).toContain("justify-end");
    expect(content.lastElementChild).toBe(
      screen.getByTestId("root-compose-compact-bottom-spacer"),
    );
  });

  it("drops the composer fade when nothing scrolls behind it", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(534);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(534);

    renderCompactHome();

    expect(screen.getByTestId("root-compose-compact-fade").hidden).toBe(true);
  });

  it("keeps the composer fade while rows overflow behind it", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(873);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(534);

    renderCompactHome();

    expect(screen.getByTestId("root-compose-compact-fade").hidden).toBe(false);
  });
});
