import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductMap, SURFACE_NUMBERS } from "../src/product-map";
import { SURFACES_BY_ID } from "../src/surfaces";
import anatomy from "../src/anatomy-manifest.json";
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
  it("uses one scroll owner for every spatial fixture and reflows only the capability grid", () => {
    const markup = renderToStaticMarkup(createElement(ProductMap));

    expect(
      markup.match(/data-guide-responsive-strategy="scroll-together"/g),
    ).toHaveLength(6);
    expect(
      markup.match(/data-guide-responsive-strategy="reflow"/g),
    ).toHaveLength(1);
    expect(markup).not.toContain("transform:scale(");
  });

  it("clips the off-stage carousel without forcing fitting desktop fixtures to scroll", () => {
    const markup = renderToStaticMarkup(createElement(ProductMap));

    expect(markup).toContain(
      "overflow-x-clip transition-[height] duration-300 ease-out",
    );
    expect(markup).toContain(
      "mx-auto w-full min-w-[720px] max-w-7xl",
    );
    expect(markup).not.toContain(
      "mx-auto w-full min-w-[720px] max-w-5xl",
    );
  });

  it("does not reserve the full header gap when the compact plugin page omits its header", () => {
    const compactMarkup = renderToStaticMarkup(createElement(ProductMap));
    const headedMarkup = renderToStaticMarkup(
      createElement(ProductMap, {
        header: createElement("h1", null, "Plugin surfaces"),
      }),
    );

    expect(compactMarkup).toContain('class="mt-2"');
    expect(headedMarkup).toContain('class="mt-8"');
  });

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

  it("keeps the real 48px tab row and places its badges in an exterior top layer", () => {
    const panelMarkup = renderWireframe(
      createElement(AppShellRightPanel, {
        activeTab: "thread-panel",
        onTabSelect: vi.fn(),
      }),
    );
    const tabStrip = panelMarkup.slice(
      0,
      panelMarkup.indexOf("data-guide-tab-body="),
    );
    const appMarkup = renderWireframe(createElement(AppShellWireframe));
    const annotationLayer = appMarkup.indexOf(
      'data-guide-annotation-layer="right-panel-tabs"',
    );
    const hostTabStrip = appMarkup.indexOf(
      'data-guide-fixture="right-panel-tab-strip"',
    );
    const layerMarkup = appMarkup.slice(annotationLayer, hostTabStrip);

    expect(tabStrip).toContain("h-12 items-center");
    expect(tabStrip).not.toContain("h-16");
    expect(tabStrip).not.toContain("items-end");
    expect(tabStrip).not.toContain("pb-2");
    expect(tabStrip).not.toContain("data-guide-badge=");
    expect(annotationLayer).toBeGreaterThan(-1);
    expect(hostTabStrip).toBeGreaterThan(annotationLayer);
    expect(layerMarkup).not.toContain("pointer-events-none");
    for (const id of ["thread-panel", "file-opener", "code-renderers"]) {
      expect(appMarkup).toMatch(
        new RegExp(
          `data-guide-badge="${id}"[\\s\\S]*?data-guide-badge-placement="outside-before"`,
        ),
      );
    }
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
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).toContain("relative min-w-[1260px] px-10 pb-4 pt-5");
  });

  it("keeps the sidebar trigger in app-owned overlay chrome", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const reserveStart = markup.indexOf(
      'data-guide-fixture="sidebar-top-reserve"',
    );
    const reserveEnd = markup.indexOf(
      'data-guide-fixture="sidebar-primary-actions"',
    );

    expect(markup).toContain('data-guide-fixture="sidebar-trigger-overlay"');
    expect(reserveStart).toBeGreaterThan(-1);
    expect(reserveEnd).toBeGreaterThan(reserveStart);
    expect(markup.slice(reserveStart, reserveEnd)).not.toContain(
      'data-guide-fixture="sidebar-trigger-overlay"',
    );
  });

  it("grows the app window within capped viewport-fit bounds while retaining loose timeline spacing", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const timeline = markup.slice(
      markup.indexOf('data-guide-fixture="app-window-timeline"'),
      markup.indexOf("Fix the flaky checkout tests"),
    );

    expect(markup).toContain("min-w-[1180px]");
    expect(markup).toContain(
      "flex min-h-[clamp(500px,calc(100dvh-528px),650px)] items-stretch",
    );
    expect(markup).toContain("flex w-[300px] shrink-0 flex-col");
    expect(timeline).toContain(
      "min-h-[clamp(350px,calc(100dvh-678px),510px)] flex-1 space-y-7",
    );
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
    const contract = anatomy.surfaceFixtures["command-palette-actions"];

    expect(contract.fidelity).toBe("flow");
    expect(contract.requiredStates).toEqual(["anchor", "triggered", "outcome"]);
    for (const state of ["anchor", "triggered"] as const) {
      for (const label of contract.labels[state]) {
        expect(markup).toContain(label);
      }
    }
    for (const label of contract.labels.outcome) {
      expect(markup).not.toContain(label);
    }
    for (const classAnchor of contract.fixtureClassAnchors) {
      expect(markup, `missing fixture class ${classAnchor}`).toContain(
        classAnchor,
      );
    }
    expect(markup).toContain('data-guide-fixture="command-palette-thread"');
    expect(markup).toContain('data-guide-fixture="command-palette-overlay"');
    expect(markup).toContain('data-guide-fixture="command-palette-dialog"');
    expect(markup).toContain('data-guide-fixture="command-palette-shortcut"');
    expect(markup).toContain('data-guide-region="command-palette-actions"');
    expect(markup).toContain('data-guide-fixture="command-palette-action"');
    expect(markup).toMatch(
      /data-guide-badge="command-palette-actions"[\s\S]*?data-guide-badge-placement="outside-before"/,
    );
    expect(markup).toContain(
      'data-guide-annotation-layer="command-palette-actions"',
    );
    expect(markup).toContain(
      "pointer-events-none absolute inset-x-0 bottom-0 top-11 z-50 grid grid-rows-3 p-1",
    );
    expect(markup).toContain(
      "pointer-events-auto row-start-2 self-center justify-self-start -ml-5 -translate-x-full",
    );
    expect(markup).toContain(
      "max-h-[min(24rem,50dvh)] overflow-y-auto p-1 text-sm",
    );
    expect(markup).not.toContain(
      "grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3",
    );
    expect(markup).not.toContain("p-1 pl-3 text-sm");
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
