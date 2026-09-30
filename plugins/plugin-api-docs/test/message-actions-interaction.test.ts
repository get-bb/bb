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
import { AppShellWireframe, SurfaceMapContext } from "../src/wireframes";

function InteractiveAppShell() {
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
    createElement(AppShellWireframe),
  );
}

describe("message action guide interaction", () => {
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
    act(() => root.render(createElement(InteractiveAppShell)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reveals the action row on message hover, then shows the selected-text toolbar on activation", () => {
    const message = container.querySelector<HTMLElement>(
      '[data-guide-fixture="assistant-message"]',
    );
    const actionRegion = container.querySelector<HTMLElement>(
      '[data-guide-region="message-actions"]',
    );
    const actionRow = container.querySelector<HTMLElement>(
      '[data-guide-fixture="message-action-hover-row"]',
    );

    expect(message).not.toBeNull();
    expect(actionRow?.className).toContain("opacity-0");
    expect(
      container.querySelector(
        '[data-guide-fixture="message-action-selection-toolbar"]',
      ),
    ).toBeNull();

    act(() => {
      message?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(actionRow?.className).toContain("opacity-100");

    act(() => actionRegion?.click());

    expect(
      container.querySelector(
        '[data-guide-fixture="message-action-selection-toolbar"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>(
        '[data-guide-fixture="message-action-selected-text"]',
      )?.className,
    ).toContain("bg-file-accent/25");
  });
});
