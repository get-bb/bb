/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { SURFACE_NUMBERS } from "../src/product-map";
import { CommandPaletteWireframe, SurfaceMapContext } from "../src/wireframes";

function InteractiveCommandPalette() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return createElement(
    SurfaceMapContext.Provider,
    {
      value: {
        activeId,
        setActiveId,
        expandedId,
        numberOf: (id: string) => SURFACE_NUMBERS.get(id) ?? null,
        onSelect: setExpandedId,
      },
    },
    createElement(CommandPaletteWireframe),
  );
}

describe("command palette guide interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(InteractiveCommandPalette)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("closes the palette and opens the release-checklist tab, then reopens from the shortcut", () => {
    const action = container.querySelector<HTMLButtonElement>(
      '[data-guide-fixture="command-palette-action"]',
    );
    const badge = container.querySelector<HTMLAnchorElement>(
      '[data-guide-badge="command-palette-actions"]',
    );

    expect(action?.getAttribute("aria-selected")).toBe("true");
    expect(
      container.querySelectorAll(
        '[data-guide-region="command-palette-actions"]',
      ),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-guide-fixture="command-palette-overlay"]'),
    ).not.toBeNull();

    act(() => badge?.click());

    expect(
      container.querySelector('[data-guide-fixture="command-palette-overlay"]'),
    ).not.toBeNull();

    act(() => action?.click());

    expect(
      container.querySelector('[data-guide-fixture="command-palette-overlay"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-guide-fixture="release-checklist-panel"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-guide-fixture="release-checklist-tab"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    const shortcut = container.querySelector<HTMLElement>(
      '[data-guide-fixture="command-palette-shortcut"]',
    );
    act(() => shortcut?.click());

    expect(
      container.querySelector('[data-guide-fixture="command-palette-overlay"]'),
    ).not.toBeNull();
  });
});
