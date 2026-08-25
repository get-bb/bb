import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SURFACE_NUMBERS } from "../src/product-map";
import { SURFACES_BY_ID } from "../src/surfaces";
import {
  AppShellRightPanel,
  AppShellWireframe,
  CommandPaletteWireframe,
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

  it("keeps tab badges clear of their right-panel entry points", () => {
    const markup = renderWireframe(
      createElement(AppShellRightPanel, {
        activeTab: "thread-panel",
        onTabSelect: vi.fn(),
      }),
    );
    const tabStrip = markup.slice(0, markup.indexOf("data-guide-tab-body="));

    expect(tabStrip).toContain("items-end");
    expect(tabStrip).toContain("h-16");
    expect(tabStrip).toContain("pb-2");
    expect(tabStrip.match(/left-1\/2 -top-6 -translate-x-1\/2/g)).toHaveLength(
      3,
    );
    expect(tabStrip).not.toContain("-bottom-3");
  });

  it("orders the right-panel tabs by annotation number", () => {
    const markup = renderWireframe(
      createElement(AppShellRightPanel, {
        activeTab: "thread-panel",
        onTabSelect: vi.fn(),
      }),
    );
    const tabStrip = markup.slice(0, markup.indexOf("data-guide-tab-body="));

    expect(tabStrip.indexOf('data-guide-tab="thread-panel"')).toBeLessThan(
      tabStrip.indexOf('data-guide-tab="file-opener"'),
    );
    expect(tabStrip.indexOf('data-guide-tab="file-opener"')).toBeLessThan(
      tabStrip.indexOf('data-guide-tab="code-renderers"'),
    );
  });

  it("places the first two sidebar badges in the exterior annotation gutter", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));

    expect(markup).toMatch(
      /data-guide-badge="nav-panel"[\s\S]*left-4 top-\[124px\]/,
    );
    expect(markup).toMatch(
      /data-guide-badge="thread-list"[\s\S]*left-4 top-\[190px\]/,
    );
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("relative min-w-[1260px] px-10 pb-4 pt-5");
  });

  it("gives the app-window timeline taller, looser skeleton geometry", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const timeline = markup.slice(
      markup.indexOf('data-guide-fixture="app-window-timeline"'),
      markup.indexOf("Fix the flaky checkout tests"),
    );

    expect(markup).toContain("min-w-[1180px]");
    expect(markup).toContain("flex min-h-[650px] items-stretch");
    expect(markup).toContain("flex w-[300px] shrink-0 flex-col");
    expect(timeline).toContain("min-h-[510px] flex-1 space-y-7");
    expect(timeline).toContain("px-5 py-6");
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

  it("renders the command-palette action on a dedicated realistic page", () => {
    const markup = renderWireframe(createElement(CommandPaletteWireframe));

    expect(markup).toContain("Search");
    expect(markup).toContain('data-guide-fixture="command-palette-thread"');
    expect(markup).toContain('data-guide-fixture="command-palette-overlay"');
    expect(markup).toContain('data-guide-fixture="command-palette-shortcut"');
    expect(markup).toContain('data-guide-region="command-palette-actions"');
    expect(markup).toContain('data-guide-fixture="command-palette-action"');
    expect(markup).toContain('role="option" aria-selected="true"');
    expect(markup).toContain("Run release checklist");
    expect(markup).toContain("Plugins");
    expect(markup).toContain("⇧⌘P");
    expect(markup).not.toContain(
      'data-guide-fixture="release-checklist-panel"',
    );
  });

  it("attaches the mention annotation to the rendered mention pill", () => {
    const markup = renderWireframe(createElement(RealComposerAnnotated));

    expect(markup).toMatch(
      /data-guide-region="mention-provider"[\s\S]*@release-notes/,
    );
  });

  it("draws a fixture-owned plugin icon inside the composer action target", () => {
    const markup = renderWireframe(createElement(RealComposerAnnotated));

    expect(markup).toMatch(
      /data-guide-region="composer-actions"[\s\S]*data-guide-fixture="plugin-composer-action"/,
    );
  });

  it("leaves annotation clearance below the open mention typeahead", () => {
    const markup = renderWireframe(createElement(RealComposerAnnotated), {
      ...mapState,
      activeId: "mention-provider",
    });

    expect(markup).toContain("bottom-full z-20 mb-5");
  });

  it("keeps the message selection toolbar closed before activation", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));

    expect(markup).toContain('data-guide-fixture="assistant-message"');
    expect(markup).not.toContain(
      'data-guide-fixture="message-action-selection-toolbar"',
    );
  });
});

describe("guide taxonomy", () => {
  it("names the renderer surface for both code and diffs", () => {
    expect(SURFACES_BY_ID.get("code-renderers")?.title).toBe(
      "Code & diff renderers",
    );
  });
});
