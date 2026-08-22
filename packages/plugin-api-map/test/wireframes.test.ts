import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SURFACE_NUMBERS } from "../src/product-map";
import { SURFACES_BY_ID } from "../src/surfaces";
import {
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

function renderWireframe(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(SurfaceMapContext.Provider, { value: mapState }, node),
  );
}

describe("guide fixture boundaries", () => {
  it("attaches file and code boundaries to their distinct fixtures", () => {
    const markup = renderWireframe(createElement(AppShellWireframe));
    const codeRegion = markup.indexOf('data-guide-region="code-renderers"');
    const fileRegion = markup.indexOf('data-guide-region="file-opener"');

    expect(codeRegion).toBeGreaterThan(-1);
    expect(fileRegion).toBeGreaterThan(codeRegion);
    expect(markup.slice(codeRegion, fileRegion)).toContain(
      'data-guide-fixture="code-renderer"',
    );
    expect(markup.slice(fileRegion)).toContain(
      'data-guide-fixture="file-viewer"',
    );
    expect(markup.slice(fileRegion)).toContain("Checkout retry notes");
  });

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
});

describe("guide taxonomy", () => {
  it("names the renderer surface for both code and diffs", () => {
    expect(SURFACES_BY_ID.get("code-renderers")?.title).toBe(
      "Code & diff renderers",
    );
  });
});
