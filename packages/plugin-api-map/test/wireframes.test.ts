import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SURFACE_NUMBERS } from "../src/product-map";
import { SURFACES_BY_ID } from "../src/surfaces";
import {
  AppShellRightPanel,
  AppShellWireframe,
  RealComposerAnnotated,
  SurfaceMapContext,
  type SurfaceMapState,
} from "../src/wireframes";

const mapState: SurfaceMapState = {
  activeId: null,
  setActiveId: vi.fn(),
  expandedId: null,
  spotlightId: null,
  numberOf: (id) => SURFACE_NUMBERS.get(id) ?? null,
};

function renderWireframe(
  node: ReactNode,
  state: SurfaceMapState = mapState,
): string {
  return renderToStaticMarkup(
    createElement(SurfaceMapContext.Provider, { value: state }, node),
  );
}

describe("guide fixture boundaries", () => {
  it("never nests one annotation link inside another", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    let anchorDepth = 0;

    for (const tag of markup.matchAll(/<a(?:\s[^>]*)?>|<\/a>/g)) {
      if (tag[0].startsWith("</")) {
        anchorDepth -= 1;
      } else {
        expect(anchorDepth).toBe(0);
        anchorDepth += 1;
      }
    }

    expect(anchorDepth).toBe(0);
  });

  it("places the right-panel annotations on their respective tabs", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));

    for (const id of ["thread-panel", "file-opener", "code-renderers"]) {
      expect(markup).toMatch(
        new RegExp(`data-guide-region="${id}"[\\s\\S]*?data-guide-tab="${id}"`),
      );
    }
  });

  it("keeps tab badges inside the clipped frame on the top Guide layer", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const codeTab = markup.slice(
      markup.indexOf('data-guide-region="code-renderers"'),
      markup.indexOf('data-guide-region="thread-panel"'),
    );

    expect(codeTab).toContain("absolute z-50");
    expect(codeTab).toContain("-top-2");
  });

  it("keeps the thread-list badge inside the sidebar's clipped edge", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const threadList = markup.slice(
      markup.indexOf('data-guide-region="thread-list"'),
      markup.indexOf("Pinned"),
    );

    expect(threadList).toContain("left-0 top-[68px]");
    expect(threadList).not.toContain("-left-3");
  });

  it("gives the app-window timeline taller, looser skeleton geometry", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const timeline = markup.slice(
      markup.indexOf('data-guide-fixture="app-window-timeline"'),
      markup.indexOf("Fix the flaky checkout tests"),
    );

    expect(markup).toContain("flex min-h-[523px] items-stretch");
    expect(timeline).toContain("min-h-[400px] flex-1 space-y-5");
    expect(timeline).toContain("px-3 py-4");
  });

  it.each([
    ["thread-panel", "thread-panel", "Release checklist"],
    ["file-opener", "file-viewer", "Checkout retry notes"],
    ["code-renderers", "diff-renderer", "checkout.test.ts"],
  ] as const)(
    "renders the %s tab's matching body",
    (activeTab, fixture, copy) => {
      const markup = renderWireframe(
        createElement(AppShellRightPanel, {
          activeTab,
          onTabSelect: vi.fn(),
        }),
      );

      expect(markup).toContain(`data-guide-tab-body="${activeTab}"`);
      expect(markup).toContain(`data-guide-fixture="${fixture}"`);
      expect(markup).toContain(copy);
    },
  );

  it("attaches the mention annotation to the rendered mention pill", () => {
    const markup = renderWireframe(
      createElement(RealComposerAnnotated, {
        composer: createElement("div", { "data-host-composer": true }),
      }),
    );

    expect(markup).toMatch(
      /data-guide-region="mention-provider"[\s\S]*@release-notes/,
    );
  });

  it("draws a fixture-owned plugin icon inside the composer action target", () => {
    const markup = renderWireframe(
      createElement(RealComposerAnnotated, {
        composer: createElement("div", { "data-host-composer": true }),
      }),
    );

    expect(markup).toMatch(
      /data-guide-region="composer-actions"[\s\S]*data-guide-fixture="plugin-composer-action"/,
    );
  });

  it("leaves annotation clearance below the open mention typeahead", () => {
    const markup = renderWireframe(
      createElement(RealComposerAnnotated, {
        composer: createElement("div", { "data-host-composer": true }),
      }),
      { ...mapState, activeId: "mention-provider" },
    );

    expect(markup).toContain("bottom-full z-20 mb-5");
  });

  it("shows the plugin messageAction entry point in the selection toolbar", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const selectionToolbar = markup.slice(
      markup.indexOf('data-guide-fixture="message-action-selection-toolbar"'),
      markup.indexOf('data-guide-region="message-actions"'),
    );

    expect(selectionToolbar).toContain("Add to chat");
    expect(selectionToolbar).toContain("Your action");
  });
});

describe("guide taxonomy", () => {
  it("names the renderer surface for both code and diffs", () => {
    expect(SURFACES_BY_ID.get("code-renderers")?.title).toBe(
      "Code & diff renderers",
    );
  });
});
