// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import {
  Panel,
  PanelGroup,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { afterEach, expect, it, vi } from "vitest";
import {
  SecondaryPanelMinimumContext,
  useSecondaryPanelSizing,
  useSecondaryPanelMinimum,
} from "./secondaryPanelSizing";

vi.mock("react-resizable-panels", async () => {
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(import.meta.url);
  return require(
    join(
      dirname(require.resolve("react-resizable-panels/package.json")),
      "dist/react-resizable-panels.browser.development.cjs.js",
    ),
  );
});

function SecondaryPanelSizingProvider({ children }: { children: ReactNode }) {
  const { ref, minimum } = useSecondaryPanelSizing();
  return (
    <div ref={ref}>
      <SecondaryPanelMinimumContext.Provider value={minimum}>
        {children}
      </SecondaryPanelMinimumContext.Provider>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("revalidates pixel minimums on container resize while preserving explicit collapse", () => {
  let width = 2400;
  let notify = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, width, 600),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const group = createRef<ImperativePanelGroupHandle>();
  function Panels() {
    const limits = useSecondaryPanelMinimum();
    return (
      <PanelGroup direction="horizontal" ref={group}>
        <Panel
          id="main"
          data-testid="main"
          collapsible
          minSize={limits.min * 100}
          defaultSize={10}
        />
        <Panel
          id="secondary"
          data-testid="secondary"
          collapsible
          minSize={(1 - limits.max) * 100}
          defaultSize={90}
        />
      </PanelGroup>
    );
  }
  render(
    <SecondaryPanelSizingProvider>
      <Panels />
    </SecondaryPanelSizingProvider>,
  );
  const size = (id: string) =>
    Number(screen.getByTestId(id).getAttribute("data-panel-size"));
  expect(size("main")).toBeCloseTo(10);
  act(() => {
    width = 800;
    notify();
  });
  expect(size("main")).toBeCloseTo(30);
  expect(size("secondary")).toBeCloseTo(70);
  act(() => group.current?.setLayout([100, 0]));
  act(() => {
    width = 600;
    notify();
  });
  expect(size("main")).toBe(100);
  expect(size("secondary")).toBe(0);
  act(() => group.current?.setLayout([0, 100]));
  act(() => {
    width = 400;
    notify();
  });
  expect(size("main")).toBe(0);
  expect(size("secondary")).toBe(100);
  act(() => group.current?.setLayout([50, 50]));
  expect(size("main")).toBe(50);
  expect(size("secondary")).toBe(50);
});
